"""
Data Searcher - Enrich Name, City, State with address, phone, email.
Serper-powered enrichment with address, phone, email extraction.
"""

import csv
import io
import os
import re
import threading
import time
import uuid

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)

SERPER_ENDPOINT = os.getenv("SERPER_ENDPOINT", "https://google.serper.dev/search")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")
# Faster defaults to keep batch runs practical; env vars can override.
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "0.35"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
SERPER_NUM_RESULTS = int(os.getenv("SERPER_NUM_RESULTS", "10"))
SERPER_CONTACT_NUM_RESULTS = int(os.getenv("SERPER_CONTACT_NUM_RESULTS", "6"))
SERPER_ADDRESS_FALLBACK_NUM_RESULTS = int(os.getenv("SERPER_ADDRESS_FALLBACK_NUM_RESULTS", "8"))

OUTPUT_HEADERS = ["Address", "Phone", "Email", "Website", "Source_URL"]
US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}

# In-memory job store (single-user local app)
jobs: dict = {}
jobs_lock = threading.Lock()


# --- Extraction helpers ---

def extract_phones(text: str) -> list[str]:
    if not text:
        return []
    re_phone = r"(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:\d{3}[-.\s]){2}\d{4}"
    matches = re.findall(re_phone, text)
    seen = set()
    out = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def extract_emails(text: str) -> list[str]:
    if not text:
        return []
    re_email = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
    matches = re.findall(re_email, text)
    seen = set()
    out = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def build_address_query(name: str, city: str, state: str) -> str:
    """Build an address-first query string while handling missing fields safely."""
    base = " ".join(part for part in [name.strip(), city.strip(), state.strip()] if part)
    return f"{base} full street address zip code".strip()


def build_contact_query(name: str, city: str, state: str) -> str:
    """Build a contact-focused query used only as bounded fallback."""
    base = " ".join(part for part in [name.strip(), city.strip(), state.strip()] if part)
    return f"{base} phone email contact".strip()


def build_address_fallback_query(name: str, city: str, state: str) -> str:
    """Build a second address-focused query for missing-address fallback."""
    base = " ".join(part for part in [name.strip(), city.strip(), state.strip()] if part)
    return f"\"{name.strip()}\" {base} current home address".strip()


def has_zip(addr: str) -> bool:
    return bool(re.search(r"\b\d{5}(?:-\d{4})?\b", addr or ""))


def has_state_code(addr: str) -> bool:
    return bool(re.search(r"\b[A-Z]{2}\b", (addr or "").upper()))


def has_street(addr: str) -> bool:
    return bool(
        re.search(
            r"\b\d{1,6}\s+[A-Za-z0-9#.\- ]{2,45}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Trail|Trl|Parkway|Pkwy|Terrace|Ter|Loop|Lp|Str)\b",
            (addr or ""),
            re.I,
        )
    )


def _trim_to_street_start(addr: str) -> str:
    """Trim noisy leading text and keep the most address-like street segment."""
    if not addr:
        return ""
    s = _normalize_address_spaces(addr)
    s = re.sub(
        r"^.*?\b(?:address is|located at|living at|present address is|address\.?)\b[:\s-]*",
        "",
        s,
        flags=re.I,
    )
    street_pat = (
        r"\b\d{1,6}\s+[A-Za-z0-9#.\- ]{2,45}"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Trail|Trl|Parkway|Pkwy|Terrace|Ter|Loop|Lp|Str)\b"
    )
    # Lookahead allows overlapping starts; this helps recover the inner clean address.
    starts = [m.start(1) for m in re.finditer(rf"(?=({street_pat}))", s, re.I)]
    if starts:
        s = s[starts[-1] :]

    # Remove common leading numeric noise fragments.
    s = re.sub(r"^\d{1,4}\s*\.\.\.\s*", "", s)
    s = re.sub(r"^\d{1,4}\s+(?:sqft|baths|people|family|individuals|different|rentable|mi)\b[^0-9]{0,80}", "", s, flags=re.I)
    return _normalize_address_spaces(s)


def _normalize_address_spaces(addr: str) -> str:
    addr = re.sub(r"\s+", " ", addr or "").strip(" ,.;")
    # Fix common scraping split like "St, reet" -> "Street".
    addr = re.sub(r"\b(St|st),\s*reet\b", "Street", addr)
    addr = re.sub(r"\b(Dr|dr),\s*ive\b", "Drive", addr)
    addr = re.sub(r"\b(Blvd|blvd),\s*oulevard\b", "Boulevard", addr)
    return addr


def _format_address_output(addr: str) -> str:
    """Normalize output to Street, City, ST, ZIP (comma before ZIP)."""
    s = _normalize_address_spaces(addr)
    if not s:
        return ""
    state_zip = r"([A-Za-z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)"
    # Already comma-separated street/city/state zip.
    m1 = re.match(rf"^(.*?),\s*([A-Za-z][A-Za-z.\- ]{{1,40}}),\s*{state_zip}$", s)
    if m1:
        street, city, state_code, zip_code = m1.group(1), m1.group(2), m1.group(3), m1.group(4)
        return f"{street.strip()}, {city.strip()}, {state_code.upper()}, {zip_code}"
    # No-comma variant between street/city/state.
    street_pat = (
        r"(\d{1,6}\s+[A-Za-z0-9#.\- ]{2,45}"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Trail|Trl|Parkway|Pkwy|Terrace|Ter|Loop|Lp|Str)\.?"
        r"(?:\s+(?:Apt|Apartment|Unit|Ste|Suite)\s*[A-Za-z0-9\-]+)?)"
    )
    m2 = re.match(rf"^{street_pat}\s+([A-Za-z][A-Za-z.\- ]{{1,40}})\s+{state_zip}$", s, re.I)
    if m2:
        street, city, state_code, zip_code = m2.group(1), m2.group(2), m2.group(3), m2.group(4)
        return f"{street.strip()}, {city.strip()}, {state_code.upper()}, {zip_code}"
    return s


def _city_state_match(addr: str, city: str, state: str) -> bool:
    addr_l = (addr or "").lower()
    city_l = (city or "").strip().lower()
    state_u = (state or "").strip().upper()
    if city_l and city_l not in addr_l:
        return False
    if state_u and state_u in US_STATE_CODES and not re.search(rf"\b{re.escape(state_u)}\b", (addr or "").upper()):
        return False
    return True


def _extract_deliverable_from_text(text: str, city: str = "", state: str = "") -> list[str]:
    """Extract strict deliverable-looking addresses from noisy text blobs."""
    if not text:
        return []
    t = re.sub(r"\s+", " ", text)
    # Strict with commas, e.g. "123 Main St, Austin, TX 78701"
    strict_comma = (
        r"\b\d{1,6}\s+[A-Za-z0-9#.\- ]{2,45}"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Trail|Trl|Parkway|Pkwy|Terrace|Ter|Loop|Lp|Str)\.?"
        r"(?:\s+(?:Apt|Apartment|Unit|Ste|Suite)\s*[A-Za-z0-9\-]+)?"
        r"\s*,\s*[A-Za-z][A-Za-z.\- ]{1,40}\s*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b"
    )
    # Relaxed no-comma, e.g. "231 Fort Bend Dr Missouri City TX 77459"
    strict_no_comma = (
        r"\b\d{1,6}\s+[A-Za-z0-9#.\- ]{2,45}"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Highway|Hwy|Trail|Trl|Parkway|Pkwy|Terrace|Ter|Loop|Lp|Str)\.?"
        r"(?:\s+(?:Apt|Apartment|Unit|Ste|Suite)\s*[A-Za-z0-9\-]+)?"
        r"\s+[A-Za-z][A-Za-z.\- ]{1,40}\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b"
    )
    raw = []
    for pat in (strict_comma, strict_no_comma):
        for m in re.finditer(pat, t, re.I):
            raw.append(_trim_to_street_start(m.group(0)))
    out: list[str] = []
    seen = set()
    for a in raw:
        key = a.lower()
        if key in seen:
            continue
        seen.add(key)
        if not (has_street(a) and has_zip(a) and has_state_code(a)):
            continue
        if not _city_state_match(a, city, state):
            continue
        out.append(a)
    return out


def extract_zip_near_address(text: str, address: str, max_chars: int = 180) -> str:
    """Try to find a nearby zip code for a partial address (bounded scan)."""
    if not text or not address:
        return ""
    # Normalize light whitespace to improve index matching.
    norm_text = re.sub(r"\s+", " ", text)
    norm_addr = re.sub(r"\s+", " ", address).strip()
    idx = norm_text.lower().find(norm_addr.lower())
    if idx == -1:
        return ""
    start = max(0, idx - 40)
    end = min(len(norm_text), idx + len(norm_addr) + max_chars)
    window = norm_text[start:end]
    m = re.search(r"\b\d{5}(?:-\d{4})?\b", window)
    return m.group(0) if m else ""


def score_address(addr: str) -> int:
    """Score address completeness 0-5: street(2) + city(1) + state(1) + zip(1).
    Higher score = more complete address."""
    if not addr:
        return 0
    score = 0
    addr_lower = addr.lower()
    # Check for street number + street name (2 points)
    if re.search(r"\d+\s+[a-z0-9\s.\-]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|circle|cir)", addr_lower):
        score += 2
    # Check for city (1 point) - look for comma-separated city name
    if re.search(r",\s*[a-z\s]+,\s*[a-z]{2}", addr_lower):
        score += 1
    # Check for state (1 point) - 2-letter state code
    if re.search(r",\s*[a-z]{2}\s+", addr_lower):
        score += 1
    # Check for zip code (1 point) - 5 digits, optionally with -4
    if re.search(r"\d{5}(?:-\d{4})?", addr):
        score += 1
    return score


def extract_addresses(text: str) -> list[str]:
    """Extract addresses, prioritizing those with zip codes."""
    if not text:
        return []
    found = []
    # Pattern 1: Full address with zip code (PRIORITIZE THESE)
    full_re = r"\d+\s+[A-Za-z0-9\s.\-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir)[,.\s]+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?"
    for m in re.finditer(full_re, text, re.I):
        found.append(m.group(0).strip())
    # Pattern 2: Street + City + State + Zip (alternative format)
    street_re = r"(\d+\s+[A-Za-z0-9\s.\-]+(?:St|Ave|Rd|Blvd|Dr|Ln|Ct)\.?)\s*[,]?\s*([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)"
    for m in re.finditer(street_re, text, re.I):
        addr = f"{m.group(1).strip()}, {m.group(2).strip()}, {m.group(3)} {m.group(4)}"
        if addr not in found:
            found.append(addr)
    # Pattern 3: Addresses without zip (lower priority, but still capture)
    street_no_zip = r"\d+\s+[A-Za-z0-9\s.\-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir)[,.\s]+[A-Za-z\s]+,\s*[A-Z]{2}(?!\s+\d{5})"
    for m in re.finditer(street_no_zip, text, re.I):
        addr = m.group(0).strip()
        if addr not in found:
            found.append(addr)

    # Pattern 4: Generic street format fallback (lowest priority, captures missed variants)
    generic_re = r"\b\d{1,6}\s+[A-Za-z0-9.\- ]{2,80},\s*[A-Za-z.\- ]{2,40},\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?"
    for m in re.finditer(generic_re, text, re.I):
        addr = re.sub(r"\s+", " ", m.group(0)).strip(" ,.")
        if addr and addr not in found:
            found.append(addr)

    # Sort by completeness score (highest first)
    scored = [(addr, score_address(addr)) for addr in found]
    scored.sort(key=lambda x: x[1], reverse=True)

    seen = set()
    out = []
    for addr, _ in scored:
        addr_normalized = addr.lower().strip()
        if addr_normalized not in seen:
            seen.add(addr_normalized)
            out.append(addr)
    return out


def choose_best_address(candidates: list[str], text: str, city: str = "", state: str = "") -> str:
    """Pick the best address using completeness score and bounded zip fallback."""
    if not candidates:
        return ""

    city_lower = (city or "").strip().lower()
    state_upper = (state or "").strip().upper()
    unique: list[str] = []
    seen = set()
    for addr in candidates:
        cleaned = _normalize_address_spaces(str(addr or ""))
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)

    scored: list[tuple[int, str]] = []
    for addr in unique:
        improved = addr
        zip_added_from_fallback = False
        if not has_zip(improved):
            nearby_zip = extract_zip_near_address(text, improved)
            if nearby_zip:
                improved = f"{improved} {nearby_zip}"
                zip_added_from_fallback = True

        score = score_address(improved)
        # Prefer addresses that already had zip over zip inferred from nearby text.
        if zip_added_from_fallback:
            score -= 1
        # Small tie-breakers for explicit city/state match.
        addr_lower = improved.lower()
        if city_lower and city_lower in addr_lower:
            score += 1
        if state_upper and re.search(rf"\b{re.escape(state_upper)}\b", improved):
            score += 1
        scored.append((score, improved))

    scored.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return scored[0][1] if scored else ""


def extract_urls(text: str) -> list[str]:
    if not text:
        return []
    re_url = r"https?://[^\s\"'<>]+"
    matches = re.findall(re_url, text)
    seen = set()
    out = []
    for u in matches:
        u = re.sub(r"[.,;:!?)]+$", "", u)
        if u not in seen and len(u) < 200:
            seen.add(u)
            out.append(u)
    return out


def _extract_from_text(text: str, source_url: str = "", city: str = "", state: str = "") -> dict:
    """Extract address, phone, email, website from raw text."""
    addresses = extract_addresses(text)
    phones = extract_phones(text)
    emails = extract_emails(text)
    urls = extract_urls(text)
    best_address = choose_best_address(addresses, text, city=city, state=state)
    return {
        "address": best_address,
        "phone": phones[0] if phones else "",
        "email": emails[0] if emails else "",
        "website": urls[0] if urls else "",
        "source_url": source_url,
    }


# --- Serper (Stage 2 - uses API quota) ---

def collect_serper_text(data: dict) -> str:
    """Collect text from Serper results, prioritizing structured address data from places."""
    parts = []
    answer_box = data.get("answerBox") or {}
    for key in ("answer", "snippet", "title"):
        if answer_box.get(key):
            parts.append(str(answer_box[key]))
    if answer_box.get("attributes"):
        for v in answer_box["attributes"].values():
            parts.append(str(v))

    # PRIORITIZE: Check places array first for structured addresses (often has full address with zip)
    for p in data.get("places") or []:
        if p.get("address"):
            # Places address is often structured and complete
            parts.append(p["address"])
        if p.get("phoneNumber"):
            parts.append(str(p["phoneNumber"]))
        if p.get("website"):
            parts.append(str(p["website"]))
        if p.get("name"):
            parts.append(p["name"])
        if p.get("snippet"):
            parts.append(p["snippet"])
    # Knowledge Graph may have address info
    kg = data.get("knowledgeGraph") or {}
    if kg.get("title"):
        parts.append(str(kg["title"]))
    if kg.get("description"):
        parts.append(kg["description"])
    if kg.get("attributes"):
        for v in kg["attributes"].values():
            parts.append(str(v))
    # Organic results
    for item in data.get("organic") or []:
        if item.get("snippet"):
            parts.append(item["snippet"])
        if item.get("title"):
            parts.append(item["title"])
        if item.get("link"):
            parts.append(item["link"])
    # People Also Ask
    for item in data.get("peopleAlsoAsk") or []:
        if item.get("snippet"):
            parts.append(item["snippet"])
        if item.get("question"):
            parts.append(item["question"])
    return " ".join(parts)


def _serper_search(query: str, num: int) -> tuple[bool, dict | str]:
    """Execute one Serper search with retries."""
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            payload = {"q": query, "num": num}
            r = requests.post(
                SERPER_ENDPOINT,
                json=payload,
                headers={"X-API-KEY": SERPER_API_KEY},
                timeout=30,
            )
            if r.status_code == 200:
                return True, r.json()
            if r.status_code in (429, 500, 502, 503):
                last_err = r.text
                time.sleep(REQUEST_DELAY * (2**attempt))
                continue
            return False, r.text[:500]
        except requests.RequestException as e:
            last_err = str(e)
            time.sleep(REQUEST_DELAY * (2**attempt))
    return False, last_err or "Max retries exceeded"


def _extract_from_serper_payload(data: dict, city: str, state: str) -> dict:
    """Parse one Serper payload into normalized enrichment result."""
    places = data.get("places") or []
    place_addresses: list[str] = []
    place_phones: list[str] = []
    place_websites: list[str] = []
    for p in places:
        if p.get("address"):
            place_addresses.append(str(p["address"]).strip())
        for phone_key in ("phoneNumber", "phone", "telephone"):
            if p.get(phone_key):
                place_phones.append(str(p[phone_key]).strip())
        if p.get("website"):
            place_websites.append(str(p["website"]).strip())

    text = collect_serper_text(data)
    organic = data.get("organic") or []
    source_url = organic[0]["link"] if organic and organic[0].get("link") else ""
    result = _extract_from_text(text, source_url, city=city, state=state)

    # Compare structured addresses vs extracted text and keep best completeness.
    candidate_addresses = list(place_addresses)
    if result.get("address"):
        candidate_addresses.append(result["address"])
    if not has_zip(result.get("address", "")):
        # Bounded fallback for zip recovery from surrounding text.
        fallback_addresses = extract_addresses(text)[:3]
        candidate_addresses.extend(fallback_addresses)
    best_any = choose_best_address(candidate_addresses, text, city=city, state=state)
    deliverable = _extract_deliverable_from_text(f"{' '.join(candidate_addresses)} {text}", city=city, state=state)
    if not deliverable and state:
        # Relaxed fallback: keep state constraint but allow city mismatch to recover more valid addresses.
        deliverable = _extract_deliverable_from_text(f"{' '.join(candidate_addresses)} {text}", city="", state=state)
    # Prefer strict deliverable extraction; if none, keep only clearly complete addresses.
    if deliverable:
        result["address"] = _format_address_output(choose_best_address(deliverable, text, city=city, state=state))
    elif best_any and has_street(best_any) and has_zip(best_any) and _city_state_match(best_any, city, state):
        result["address"] = _format_address_output(best_any)
    else:
        result["address"] = ""

    if place_phones and not result.get("phone"):
        result["phone"] = place_phones[0]
    if place_websites and not result.get("website"):
        result["website"] = place_websites[0]
    if not result.get("source_url"):
        result["source_url"] = result.get("website", "")
    return result


def _merge_results(primary: dict, fallback: dict, city: str, state: str) -> dict:
    """Merge two Serper extraction results, preserving best address and missing contacts."""
    merged = dict(primary)
    merged["address"] = _format_address_output(choose_best_address(
        [primary.get("address", ""), fallback.get("address", "")],
        f"{primary.get('address', '')} {fallback.get('address', '')}",
        city=city,
        state=state,
    ))
    for field in ("phone", "email", "website", "source_url"):
        if not merged.get(field) and fallback.get(field):
            merged[field] = fallback[field]
    return merged


def serper_lookup(name: str, city: str, state: str) -> dict:
    """Call Serper API and extract address, phone, email from results.
    Address-first primary query with bounded contact fallback."""
    if not SERPER_API_KEY:
        return {"ok": False, "error": "SERPER_API_KEY not set"}

    ok, data_or_error = _serper_search(build_address_query(name, city, state), SERPER_NUM_RESULTS)
    if not ok:
        return {"ok": False, "error": str(data_or_error)}
    primary = _extract_from_serper_payload(data_or_error, city=city, state=state)

    # Bounded fallback: one extra address query only when address is still missing.
    if not primary.get("address"):
        ok_addr, data_addr = _serper_search(
            build_address_fallback_query(name, city, state), SERPER_ADDRESS_FALLBACK_NUM_RESULTS
        )
        if ok_addr:
            secondary_addr = _extract_from_serper_payload(data_addr, city=city, state=state)
            primary = _merge_results(primary, secondary_addr, city=city, state=state)

    # Bounded fallback: one extra query only if contact fields are still missing.
    if not primary.get("phone") or not primary.get("email"):
        ok2, data_or_error2 = _serper_search(build_contact_query(name, city, state), SERPER_CONTACT_NUM_RESULTS)
        if ok2:
            secondary = _extract_from_serper_payload(data_or_error2, city=city, state=state)
            primary = _merge_results(primary, secondary, city=city, state=state)

    primary["address"] = _format_address_output(primary.get("address", ""))
    primary["ok"] = True
    return primary


# --- CSV helpers ---

def parse_csv_content(content: str) -> tuple[list[str], list[list[str]]]:
    reader = csv.reader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        return [], []
    headers = [str(h or "").strip() for h in rows[0]]
    return headers, rows[1:]


def get_row_value(row: list[str], headers: list[str], col_name: str) -> str:
    if col_name not in headers:
        return ""
    idx = headers.index(col_name)
    return str(row[idx] or "").strip() if idx < len(row) else ""


def build_csv_string(headers: list[str], rows: list[list[str]]) -> str:
    out = io.StringIO()
    csv.writer(out).writerow(headers)
    csv.writer(out).writerows(rows)
    return out.getvalue()


# --- Enrichment job (runs in background) ---

def run_enrichment_job(job_id: str, payload: dict) -> None:
    content = payload["file"]
    city_col = payload.get("cityCol", "")
    state_col = payload.get("stateCol", "")
    limit = payload.get("limit", 50)
    name_col = payload.get("nameCol")
    first_col = payload.get("firstNameCol")
    last_col = payload.get("lastNameCol")
    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": 0, "total": 0, "stage": "serper", "enriched": 0}

    try:
        headers, rows = parse_csv_content(content)
        out_headers = list(headers)
        for h in OUTPUT_HEADERS:
            if h not in out_headers:
                out_headers.append(h)

        use_first_last = first_col and last_col and first_col in headers and last_col in headers
        limit = len(rows) if limit == "all" or limit is None else min(int(limit), len(rows))
        rows_to_process = rows[:limit]

        with jobs_lock:
            jobs[job_id]["total"] = limit

        output_rows = []
        enriched_count = 0

        for i, row in enumerate(rows_to_process):
            if use_first_last:
                name = f"{get_row_value(row, headers, first_col)} {get_row_value(row, headers, last_col)}".strip()
            else:
                name = get_row_value(row, headers, name_col)
            city = get_row_value(row, headers, city_col)
            state = get_row_value(row, headers, state_col)

            with jobs_lock:
                jobs[job_id]["current"] = i + 1
                jobs[job_id]["stage"] = "serper"
            result = serper_lookup(name, city, state)
            time.sleep(REQUEST_DELAY)

            if result.get("ok"):
                addr = result.get("address", "")
                phone = result.get("phone", "")
                email = result.get("email", "")
                website = result.get("website", "")
                source_url = result.get("source_url", "")
                if addr or phone or email:
                    enriched_count += 1
            else:
                addr = phone = email = website = source_url = ""

            row_dict = {h: (row[j] if j < len(row) else "") for j, h in enumerate(headers)}
            row_dict.update(Address=addr, Phone=phone, Email=email, Website=website, Source_URL=source_url)
            output_rows.append([row_dict.get(h, "") for h in out_headers])

        csv_out = build_csv_string(out_headers, output_rows)
        with jobs_lock:
            jobs[job_id].update(
                status="done",
                current=limit,
                csv=csv_out,
                processed=limit,
                enriched=enriched_count,
            )
    except Exception as e:
        with jobs_lock:
            jobs[job_id].update(status="error", error=str(e))


# --- Routes ---

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/columns", methods=["POST"])
def api_columns():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f or not f.filename.lower().endswith(".csv"):
        return jsonify({"error": "Please upload a CSV file"}), 400
    try:
        content = f.read().decode("utf-8", errors="replace")
        headers, rows = parse_csv_content(content)
        if not headers:
            return jsonify({"error": "CSV has no headers"}), 400
        return jsonify({"headers": headers, "rowCount": len(rows)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/enrich/start", methods=["POST"])
def api_enrich_start():
    data = request.get_json()
    if not data or "file" not in data:
        return jsonify({"error": "No file content"}), 400

    city_col = data.get("cityCol", "")
    state_col = data.get("stateCol", "")
    name_col = data.get("nameCol")
    first_col = data.get("firstNameCol")
    last_col = data.get("lastNameCol")

    try:
        headers, _ = parse_csv_content(data["file"])
    except Exception as e:
        return jsonify({"error": f"Invalid CSV: {e}"}), 400

    use_first_last = first_col and last_col and first_col in headers and last_col in headers
    if not use_first_last and (not name_col or name_col not in headers):
        return jsonify({"error": "Specify Name or First+Last Name columns"}), 400
    if not city_col or city_col not in headers:
        return jsonify({"error": "City column not found"}), 400
    if not state_col or state_col not in headers:
        return jsonify({"error": "State column not found"}), 400

    if not SERPER_API_KEY:
        return jsonify({"error": "SERPER_API_KEY is required in .env"}), 400

    job_id = str(uuid.uuid4())
    thread = threading.Thread(target=run_enrichment_job, args=(job_id, data))
    thread.daemon = True
    thread.start()

    return jsonify({"jobId": job_id})


@app.route("/api/enrich/status/<job_id>")
def api_enrich_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
