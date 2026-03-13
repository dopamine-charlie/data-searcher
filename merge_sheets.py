#!/usr/bin/env python3
"""
Merge Data Searcher output with Tracer Fire (or any other) export.
Matches rows by Name + City + State, combines data from both sources.
No data loss: fills blanks from the other sheet when one has data and the other doesn't.
"""

import argparse
import csv
import io
import re
import sys


def normalize(s: str) -> str:
    """Lowercase, strip, collapse spaces."""
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s).lower().strip())


def find_col(headers: list[str], names: list[str]) -> int:
    """Find column index by header name (case-insensitive)."""
    for i, h in enumerate(headers):
        h = headers[i].lower().strip()
        for n in names:
            if n.lower() in h or h in n.lower():
                return i
    return -1


def get_name(row: list[str], headers: list[str], first_col: int, last_col: int, name_col: int) -> str:
    """Get full name from row."""
    if first_col >= 0 and last_col >= 0:
        first = str(row[first_col] or "").strip()
        last = str(row[last_col] or "").strip()
        return f"{first} {last}".strip()
    if name_col >= 0:
        return str(row[name_col] or "").strip()
    return ""


def make_key(row: list[str], headers: list[str], name_cols: dict) -> str:
    """Create merge key: normalized name + city + state."""
    name = get_name(row, headers, name_cols.get("first", -1), name_cols.get("last", -1), name_cols.get("name", -1))
    city = str(row[name_cols["city"]] or "").strip() if name_cols["city"] >= 0 else ""
    state = str(row[name_cols["state"]] or "").strip() if name_cols["state"] >= 0 else ""
    return f"{normalize(name)}|{normalize(city)}|{normalize(state)}"


def detect_name_cols(headers: list[str]) -> dict:
    """Detect name, city, state columns."""
    first = find_col(headers, ["first name", "firstname", "first"])
    last = find_col(headers, ["last name", "lastname", "last"])
    name = find_col(headers, ["name", "full name"]) if (first < 0 or last < 0) else -1
    city = find_col(headers, ["city"])
    state = find_col(headers, ["state"])
    return {"name": name, "first": first, "last": last, "city": city, "state": state}


def load_csv(path: str) -> tuple[list[str], list[list[str]]]:
    """Load CSV, return (headers, rows)."""
    with open(path, encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        return [], []
    headers = [str(h or "").strip() for h in rows[0]]
    return headers, rows[1:]


def main():
    parser = argparse.ArgumentParser(
        description="Merge Data Searcher + Tracer Fire (or any) CSVs by Name+City+State."
    )
    parser.add_argument("data_searcher", help="Data Searcher enriched CSV (or first file)")
    parser.add_argument("tracer_fire", help="Tracer Fire export CSV (or second file)")
    parser.add_argument("-o", "--output", default="merged_output.csv", help="Output CSV path")
    parser.add_argument("--prefer", choices=["first", "second"], default="first",
        help="When both have data for same field: prefer first (Data Searcher) or second (Tracer Fire)")
    args = parser.parse_args()

    h1, rows1 = load_csv(args.data_searcher)
    h2, rows2 = load_csv(args.tracer_fire)

    if not h1 or not h2:
        print("Error: One or both files are empty or invalid.", file=sys.stderr)
        sys.exit(1)

    cols1 = detect_name_cols(h1)
    cols2 = detect_name_cols(h2)

    if cols1["city"] < 0 or cols1["state"] < 0:
        print("Error: First file needs City and State columns.", file=sys.stderr)
        sys.exit(1)
    if cols2["city"] < 0 or cols2["state"] < 0:
        print("Error: Second file needs City and State columns.", file=sys.stderr)
        sys.exit(1)

    # Build unified header: all columns from both, deduplicated, left-to-right
    seen = set()
    out_headers = []
    for h in h1 + h2:
        hn = h.lower().strip()
        if hn and hn not in seen:
            seen.add(hn)
            out_headers.append(h)

    # Build index: header -> [(file_idx, col_idx), ...]
    col_to_src = {}
    for i, h in enumerate(h1):
        hn = h.lower().strip()
        if hn:
            col_to_src.setdefault(hn, []).append((0, i))
    for i, h in enumerate(h2):
        hn = h.lower().strip()
        if hn:
            col_to_src.setdefault(hn, []).append((1, i))

    # Map: key -> list of values for out_headers
    by_key = {}

    def set_val(merged: list[str], j: int, val: str, from_first: bool) -> None:
        if not val:
            return
        if not merged[j]:
            merged[j] = val
        elif from_first and args.prefer == "first":
            merged[j] = val
        elif not from_first and args.prefer == "second":
            merged[j] = val

    for row in rows1:
        while len(row) < len(h1):
            row.append("")
        key = make_key(row, h1, cols1)
        if key not in by_key:
            by_key[key] = [""] * len(out_headers)
        merged = by_key[key]
        for j, oh in enumerate(out_headers):
            ohn = oh.lower().strip()
            for src, idx in col_to_src.get(ohn, []):
                if src == 0 and idx < len(row):
                    set_val(merged, j, str(row[idx] or "").strip(), from_first=True)
                    break

    for row in rows2:
        while len(row) < len(h2):
            row.append("")
        key = make_key(row, h2, cols2)
        if key not in by_key:
            by_key[key] = [""] * len(out_headers)
        merged = by_key[key]
        for j, oh in enumerate(out_headers):
            ohn = oh.lower().strip()
            for src, idx in col_to_src.get(ohn, []):
                if src == 1 and idx < len(row):
                    set_val(merged, j, str(row[idx] or "").strip(), from_first=False)
                    break

    # Write output
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(out_headers)
        for key in sorted(by_key.keys()):
            w.writerow(by_key[key])

    print(f"Merged {len(rows1)} rows (Data Searcher) + {len(rows2)} rows (Tracer Fire) → {len(by_key)} unique people")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
