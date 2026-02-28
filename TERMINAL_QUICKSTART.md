# Data Searcher – Run in Terminal (Python)

**Fastest way to enrich your list.** No Google Sheets, no Apps Script. Just CSV in, CSV out.

---

## 1. One-time setup (2 minutes)

### Install Python dependencies

```bash
cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
pip install -r requirements.txt
```

### Set your Serper API key

1. Get a free key at [serper.dev](https://serper.dev) (or use the same key from the Apps Script if you have it)
2. Create a file named `.env` in this folder with:

```
SERPER_API_KEY=your_actual_key_here
```

(Or copy `.env.example` to `.env` and edit it.)

---

## 2. Run the script

### Your CSV must have these columns (row 1 = headers):

- **Name** (or First Name + Last Name in separate columns)
- **City**
- **State**

### Command:

```bash
python3 enrich_contacts.py your_input.csv enriched_output.csv
```

**Or use the run script:**

```bash
./run_enrich.sh raw_list.csv enriched_list.csv
```

**Example:**

```bash
python3 enrich_contacts.py raw_list.csv enriched_list.csv
```

The script will:
- Read `raw_list.csv`
- Call Serper API for each row (~1 sec per row)
- Write `enriched_list.csv` with new columns: **Address**, **City_Enriched**, **State_Enriched**, **Zip**, **Phone**, **Email**

---

## 3. Optional flags

| Flag | Example | Purpose |
|------|---------|---------|
| `--limit N` | `--limit 5` | Process only first N rows (for testing) |
| `--delay N` | `--delay 1.5` | Seconds between API calls (default 1) |
| `--name-col "Full Name"` | | If your name column has a different header |
| `--city-col "City"` | | If your city column has a different header |
| `--state-col "State"` | | If your state column has a different header |

**Test with 3 rows first:**

```bash
python3 enrich_contacts.py raw_list.csv test_output.csv --limit 3
```

---

## 4. Import back into Google Sheets

1. Open Google Sheets
2. **File → Import → Upload**
3. Select `enriched_output.csv`
4. Choose "Replace spreadsheet" or "Insert new sheet"

---

## Troubleshooting

- **"SERPER_API_KEY not set"** → Create `.env` file with your key
- **"Input file not found"** → Use full path: `python3 enrich_contacts.py /path/to/input.csv output.csv`
- **API errors** → Check your Serper quota at serper.dev
