# Data Searcher – Troubleshooting

## If Google Apps Script isn't working

### 1. Use the **custom menu** instead of the script editor

After you add the script and **reload the sheet** (close and reopen, or refresh):

1. In your Google Sheet, look at the **menu bar** (File, Edit, View, etc.)
2. You should see **"Data Searcher"** as a new menu
3. Click **Data Searcher** → **Enrich All Rows** (or **Enrich Selected Rows**)

You don’t need to open the Apps Script editor to run it.

---

### 2. Can't find Extensions → Apps Script?

- **Desktop browser only** – Apps Script doesn’t work on the mobile Sheets app
- **Menu location** – Top menu bar: **Extensions** → **Apps Script**
- If you don’t see **Extensions**, try:
  - Refreshing the page
  - Using Chrome or another desktop browser
  - Checking you’re on **sheets.google.com** (not an embedded view)

---

### 3. Running from the Apps Script editor

1. **Extensions** → **Apps Script** (opens in a new tab)
2. In the script editor, find the **function dropdown** (top toolbar, often says "Select function")
3. Choose **runEnrichment**
4. Click the **Run** button (▶ play icon)
5. First run: approve permissions (Review permissions → your account → Advanced → Go to project → Allow)

---

### 4. Common errors

| Error | Fix |
|-------|-----|
| "Could not find Name, City, State columns" | Row 1 must have headers containing "name", "city", "state" (case doesn’t matter) |
| "Need at least a header row and one data row" | Add at least one data row below the header |
| "Serper API error" | Check your API key in the script (line 17) or in `.env` for Python |
| Nothing happens / no menu | Reload the sheet after adding the script so `onOpen` runs |
| "Authorization required" | Complete the permission flow when prompted |

---

### 5. Alternative: Use the Python script

If Apps Script keeps failing, use the Python version:

1. **Export** your sheet: File → Download → Comma-separated values (.csv)
2. **Run** in Terminal:
   ```bash
   cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
   python3 enrich_contacts.py your_export.csv enriched_output.csv
   ```
3. **Import** the result: In a new sheet, File → Import → Upload → choose `enriched_output.csv`

The Python script uses the same `.env` file and Serper API key.

---

### 6. Security note

Your Serper API key is in the script. If you share the sheet or script, others can see it. For Apps Script, consider using [Script Properties](https://developers.google.com/apps-script/guides/properties) instead of hardcoding.
