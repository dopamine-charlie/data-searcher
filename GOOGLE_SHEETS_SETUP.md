# Data Searcher - Google Sheets Setup

Everything runs inside Google Sheets. No Terminal. No CSV.

---

## Step 1: Put your data in the sheet

1. Open your Google Sheet (or create one)
2. Row 1 = headers. Use: **Name**, **City**, **State**
3. Row 2 and below = your data

Example:

| Name       | City      | State |
|------------|-----------|-------|
| John Doe   | Roanoke   | VA    |
| Jane Smith | Austin    | TX    |

---

## Step 2: Add the script

1. In that same Google Sheet, click **Extensions** → **Apps Script**
2. A new tab opens (the script editor)
3. Delete any code that's there
4. Copy the entire contents of `DataSearcher.gs` and paste it in
5. Click **Save** (disk icon or Ctrl+S)

---

## Step 3: Run the enrichment

**Option A – From the sheet (easiest):**

1. Go back to your Google Sheet tab
2. Refresh the page (or close and reopen) so the custom menu appears
3. Click **Data Searcher** in the menu bar → **Enrich All Rows** (or **Enrich Selected Rows**)
4. First time only: Google asks for permissions → "Review permissions" → your account → "Advanced" → "Go to [project name]" → "Allow"
5. Wait. A popup will say "Enriching X rows..." — click OK. It runs (about 1 second per row)
6. When done, another popup says "Done! Enriched X of Y rows."

**Option B – From the Apps Script editor:**

1. In the Apps Script editor, find the dropdown at the top (it may say "Select function" or show the current function name)
2. Click it and select **runEnrichment**
3. Click the **Run** button (play icon ▶)
4. First time only: Google asks for permissions (same as above)
5. Wait for the popups as above

**If something doesn't match:** See `TROUBLESHOOTING.md` for common issues and the Python alternative.

---

## Step 4: See the results

1. Go back to the tab with your Google Sheet
2. New columns appear to the right: **Address**, **City_Enriched**, **State_Enriched**, **Zip**, **Phone**, **Email**

---

## Important

- The script must be opened from **your** sheet (Extensions → Apps Script from the sheet). It enriches that sheet.
- If you have multiple sheets in the workbook, it enriches the one that's currently active (or the first one when running from the editor).

---

## Troubleshooting

- **"Could not find Name, City, State columns"** — Row 1 must have headers with "name", "city", "state" (case doesn't matter)
- **"Need at least a header row and one data row"** — You need data in row 2+
- **"Serper API error"** — API key issue; check the script
- **Ran but nothing changed** — Make sure you opened Apps Script from the sheet that has your data (Extensions → Apps Script from that sheet)
