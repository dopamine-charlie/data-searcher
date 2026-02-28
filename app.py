"""
Data Searcher - Enrich Name, City, State with address, phone, email.
Stage 1: DuckDuckGo (free). Stage 2: Serper (2,500 free/month).
"""

import csv
import io
import os
import re
import threading
import time
import uuid
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)

SERPER_ENDPOINT = os.getenv("SERPER_ENDPOINT", "https://google.serper.dev/search")
SERPER_API_KEY = os.getenv("SERPER_API_KEY")
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "1.0"))
DUCK_DELAY = float(os.getenv("DUCK_DELAY", "1.5"))  # Slightly longer for free scraping
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))

OUTPUT_HEADERS = ["Address", "Phone", "Email", "Website", "Source_URL"]

# DuckDuckGo garbage we treat as "no result" so Serper gets a chance
DUCK_GARBAGE_EMAILS = {"error-lite@duckduckgo.com"}
DUCK_REDIRECT_PREFIX = "duckduckgo.com/l/?uddg="

# In-memory job store (single-user local app)
jobs: dict = {}
jobs_lock = threading.Lock()


def is_duck_garbage(result: dict) -> bool:
    """Return True if DuckDuckGo returned placeholder/garbage (e.g. error-lite@duckduckgo.com)."""
    email = (result.get("email") or "").lower().strip()
    if email and ("duckduckgo.com" in email or email in DUCK_GARBAGE_EMAILS):
        return True
    src = (result.get("source_url") or "").lower()
    if DUCK_REDIRECT_PREFIX in src:
        return True
    return False


def clear_duck_garbage(result: dict) -> dict:
    """Treat DuckDuckGo garbage as empty so Serper fallback triggers."""
    if not is_duck_garbage(result):
        return result
    return {
        **result,
        "address": "",
        "phone": "",
        "email": "",
        "website": "",
        "source_url": "",
    }


# --- Extraction (shared by DuckDuckGo and Serper) ---

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


def extract_addresses(text: str) -> list[str]:
    if not text:
        return []
    found = []
    full_re = r"\d+\s+[A-Za-z0-9\s.\-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir)[,.\s]+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?"
    for m in re.finditer(full_re, text, re.I):
        found.append(m.group(0).strip())
    street_re = r"(\d+\s+[A-Za-z0-9\s.\-]+(?:St|Ave|Rd|Blvd|Dr|Ln|Ct)\.?)\s*[,]?\s*([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)"
    for m in re.finditer(street_re, text, re.I):
        addr = f"{m.group(1).strip()}, {m.group(2).strip()}, {m.group(3)} {m.group(4)}"
        if addr not in found:
            found.append(addr)
    seen = set()
    out = []
    for a in found:
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out


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


def _extract_from_text(text: str, source_url: str = "") -> dict:
    """Extract address, phone, email, website from raw text."""
    addresses = extract_addresses(text)
    phones = extract_phones(text)
    emails = extract_emails(text)
    urls = extract_urls(text)
    return {
        "address": addresses[0] if addresses else "",
        "phone": phones[0] if phones else "",
        "email": emails[0] if emails else "",
        "website": urls[0] if urls else "",
        "source_url": source_url,
    }


# --- DuckDuckGo (Stage 1 - free) ---

def duckduckgo_lookup(name: str, city: str, state: str) -> dict:
    """Scrape DuckDuckGo HTML and extract contact info. No API key needed."""
    parts = [p.strip() for p in [name, city, state] if p and p.strip()]
    query = ", ".join(parts) + " address phone email"
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        text = soup.get_text(separator=" ")
        # Try to get first result link as source
        first_link = soup.select_one("a.result__a")
        source_url = first_link.get("href", "") if first_link else ""
        result = _extract_from_text(text, source_url)
        result["ok"] = True
        return result
    except Exception as e:
        return {"ok": False, "error": str(e), "address": "", "phone": "", "email": "", "website": "", "source_url": ""}


# --- Serper (Stage 2 - uses API quota) ---

def collect_serper_text(data: dict) -> str:
    parts = []
    kg = data.get("knowledgeGraph") or {}
    if kg.get("description"):
        parts.append(kg["description"])
    if kg.get("attributes"):
        for v in kg["attributes"].values():
            parts.append(str(v))
    for item in data.get("organic") or []:
        if item.get("snippet"):
            parts.append(item["snippet"])
        if item.get("title"):
            parts.append(item["title"])
        if item.get("link"):
            parts.append(item["link"])
    for item in data.get("peopleAlsoAsk") or []:
        if item.get("snippet"):
            parts.append(item["snippet"])
    for p in data.get("places") or []:
        if p.get("name"):
            parts.append(p["name"])
        if p.get("address"):
            parts.append(p["address"])
        if p.get("snippet"):
            parts.append(p["snippet"])
    return " ".join(parts)


def serper_lookup(name: str, city: str, state: str) -> dict:
    """Call Serper API and extract address, phone, email from results."""
    if not SERPER_API_KEY:
        return {"ok": False, "error": "SERPER_API_KEY not set"}

    parts = [p.strip() for p in [name, city, state] if p and p.strip()]
    query = ", ".join(parts) + " address phone email"
    payload = {"q": query, "num": 10}

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.post(
                SERPER_ENDPOINT,
                json=payload,
                headers={"X-API-KEY": SERPER_API_KEY},
                timeout=30,
            )
            if r.status_code == 200:
                data = r.json()
                text = collect_serper_text(data)
                organic = data.get("organic") or []
                source_url = organic[0]["link"] if organic and organic[0].get("link") else ""
                result = _extract_from_text(text, source_url)
                result["ok"] = True
                return result
            if r.status_code in (429, 500, 502, 503):
                last_err = r.text
                time.sleep(REQUEST_DELAY * (2**attempt))
                continue
            return {"ok": False, "error": r.text[:500]}
        except requests.RequestException as e:
            last_err = str(e)
            time.sleep(REQUEST_DELAY * (2**attempt))

    return {"ok": False, "error": last_err or "Max retries exceeded"}


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
    mode = payload.get("mode", "duck_then_serper")  # duck_then_serper | serper_only | duck_only

    with jobs_lock:
        jobs[job_id] = {"status": "running", "current": 0, "total": 0, "stage": "duckduckgo", "enriched": 0}

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

            result = None

            if mode == "serper_only":
                with jobs_lock:
                    jobs[job_id]["current"] = i + 1
                    jobs[job_id]["stage"] = "serper"
                result = serper_lookup(name, city, state)
                time.sleep(REQUEST_DELAY)
            else:
                with jobs_lock:
                    jobs[job_id]["current"] = i + 1
                    jobs[job_id]["stage"] = "duckduckgo"
                result = duckduckgo_lookup(name, city, state)
                time.sleep(DUCK_DELAY)

                # Treat DuckDuckGo garbage (error-lite@duckduckgo.com, redirect URLs) as empty
                result = clear_duck_garbage(result)

                # Stage 2: Serper fallback if DuckDuckGo didn't find real data (and we have API key)
                if mode == "duck_then_serper" and (
                    not result.get("address") and not result.get("phone") and not result.get("email")
                ) and SERPER_API_KEY:
                    with jobs_lock:
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

    mode = data.get("mode", "duck_then_serper")
    if mode == "serper_only" and not SERPER_API_KEY:
        return jsonify({"error": "Serper-only mode requires SERPER_API_KEY in .env"}), 400

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
