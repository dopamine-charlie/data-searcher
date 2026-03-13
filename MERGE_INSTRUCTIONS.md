# Merge Data Searcher + Tracer Fire Results

Use the `merge_sheets.py` script to combine your Data Searcher output with Tracer Fire (or FastAppend) export into one spreadsheet.

**How it works:** Matches rows by **Name + City + State**. When the same person appears in both files, it fills in blanks from the other. No data is lost.

---

## Quick start

```bash
cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
source venv/bin/activate
python3 merge_sheets.py data_searcher_enriched.csv tracer_fire_export.csv -o merged.csv
```

---

## Step-by-step

### 1. Get your two files

- **Data Searcher output** – The CSV you downloaded from the web app (has Name, City, State, Address, Phone, Email, etc.)
- **Tracer Fire / FastAppend export** – The CSV you get from Tracer 5 or FastAppend (must have Name or First+Last, City, State)

### 2. Put both files in the project folder

Or note their full paths.

### 3. Run the merge

```bash
cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
source venv/bin/activate
python3 merge_sheets.py YOUR_DATA_SEARCHER_FILE.csv YOUR_TRACER_FIRE_FILE.csv -o merged_output.csv
```

Replace the filenames with your actual files.

### 4. Check the output

Open `merged_output.csv`. You should see:

- One row per unique person (matched by Name + City + State)
- All columns from both files combined
- Blanks filled in from the other file when one had data and the other didn’t

---

## Options

| Option | What it does |
|--------|---------------|
| `-o merged.csv` | Output file name (default: merged_output.csv) |
| `--prefer first` | When both have data for same field, use Data Searcher’s (default) |
| `--prefer second` | When both have data for same field, use Tracer Fire’s |

**Example – prefer Tracer Fire when both have data:**

```bash
python3 merge_sheets.py data_searcher.csv tracer_fire.csv -o merged.csv --prefer second
```

---

## Required columns

Both files must have:

- **Name** (or **First Name** + **Last Name**)
- **City**
- **State**

The script auto-detects these. Other columns (Address, Phone, Email, etc.) are merged.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "City column not found" | Add a City column to your CSV |
| "State column not found" | Add a State column to your CSV |
| Rows not matching | Names must match (e.g. "John Smith" = "John Smith"). Check spelling and spacing. |
| Duplicate people | The script merges duplicates into one row. If Name+City+State differ slightly, they’ll stay separate. |
