# Data Searcher – Google Apps Script Setup Guide

**Last updated: February 22, 2026**  
**Sources: Google Developers docs, Apps Script release notes, Workspace Updates blog**

This guide walks you through setting up the Data Searcher Apps Script in Google Sheets using the current process as of February 2026.

---

## Prerequisites

- **Google Account** (personal or Google Workspace)
- **Desktop web browser** (Chrome, Safari, Firefox, or Edge) – Apps Script does not work in the mobile Google Sheets app
- **Edit access** to the spreadsheet – only editors can run bound scripts; viewers cannot
- **Serper API key** – already in the script; get your own at [serper.dev](https://serper.dev) if needed

---

## Part 1: Prepare Your Google Sheet

### Step 1.1: Open or Create a Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Sign in with your Google account
3. Either:
   - **Create new:** Click the **+ Blank** button (or **File → New → Spreadsheet**)
   - **Use existing:** Open a spreadsheet you already have

### Step 1.2: Set Up Your Data Layout

1. **Row 1 must be headers.** Use these column names (case doesn’t matter):
   - **Name** (or **First Name** and **Last Name** in separate columns)
   - **City**
   - **State**

2. **Row 2 and below:** Your data rows

Example:

| Name       | City      | State |
|------------|-----------|-------|
| John Doe   | Roanoke   | VA    |
| Jane Smith | Austin    | TX    |

3. Save the spreadsheet (Ctrl+S or Cmd+S) if you created or changed it.

---

## Part 2: Add the Apps Script

### Step 2.1: Open the Apps Script Editor

1. In your Google Sheet, look at the **top menu bar** (File, Edit, View, Insert, Format, Data, Tools, Extensions, Help)
2. Click **Extensions**
3. In the dropdown, click **Apps Script**
4. A new browser tab opens with the **Apps Script editor**

**If you don’t see Extensions:**
- Refresh the page
- Confirm you’re on [sheets.google.com](https://sheets.google.com)
- Use a desktop browser, not the mobile app

### Step 2.2: Replace the Default Code

1. In the Apps Script editor, you’ll see a file named `Code.gs` (or similar) with starter code
2. **Select all** the existing code (Ctrl+A or Cmd+A)
3. **Delete** it
4. Open the file **`DataSearcher_AppScript_UPDATED_2026-02-22.txt`** from your project folder (use this updated version)
5. **Copy** the entire contents (Ctrl+A, Ctrl+C)
6. **Paste** into the Apps Script editor (Ctrl+V or Cmd+V)

### Step 2.3: Save the Project

1. Click the **Save** icon (disk) in the toolbar, or press Ctrl+S (Cmd+S on Mac)
2. The first time you save, you may be asked to name the project
3. Enter a name (e.g. **Data Searcher**) and click **OK** or **Rename**
4. Confirm the project is saved (no unsaved changes indicator)

### Step 2.4: (Optional) Update Your Serper API Key

1. In the script, find the line: `const SERPER_API_KEY = '...';`
2. Replace the value with your own key from [serper.dev](https://serper.dev) if you want to use your own quota
3. Save again

---

## Part 3: Run the Script (First Time – Authorization)

### Step 3.1: Select the Function to Run

1. In the Apps Script editor, look at the **top toolbar** (above the code)
2. Find the **function selector dropdown** – it may say “Select function” or show a function name
3. Click the dropdown
4. Select **runEnrichment**

### Step 3.2: Click Run

1. Click the **Run** button (▶ play icon) in the toolbar  
   - Or use **Ctrl+R** (Windows) or **⌘+R** (Mac)
2. The script will start and then stop for authorization

### Step 3.3: Authorize the Script (First Run Only)

When the script first accesses your data or external services, Google will ask for permission.

**Step A – Authorization dialog**

1. A dialog may appear: **“Authorization required”** or **“runEnrichment needs your permission”**
2. Click **Review permissions** (or similar)

**Step B – Choose account**

1. A new tab or window opens
2. Choose the Google account that owns the spreadsheet
3. Click it to continue

**Step C – “Google hasn’t verified this app” (personal accounts)**

1. You may see: **“This app isn’t verified”**
2. Click **Advanced**
3. Click **Go to [Your Project Name] (unsafe)**
4. This is expected for your own script; you are the developer

**Step D – Granular OAuth (2025+ consent screen)**

1. You may see a list of permissions (e.g. “See, edit, create, and delete all your Google Sheets spreadsheets”)
2. As of January 2025, you can choose which scopes to allow
3. For Data Searcher to work, allow access to **Sheets** and any **external network** access (for the Serper API)
4. Click **Allow** (or the equivalent for each scope you want to grant)

**Step E – Done**

1. The authorization window closes
2. Return to the Apps Script editor
3. The script may run again automatically, or you may need to click **Run** again

### Step 3.4: If Authorization Fails

- If you see **“Script has been running for too long”** or similar, the script may have timed out; try again with fewer rows
- If you see **“PERMISSION_DENIED”**, ensure you’re using the same Google account that owns the spreadsheet
- You can revoke access later at [myaccount.google.com/connections](https://myaccount.google.com/connections)

---

## Part 4: Run the Script (Ongoing Use)

You can run the script in two ways.

### Method A: From the Custom Menu (Recommended)

1. Go back to the **Google Sheet** tab (not the Apps Script tab)
2. **Refresh the page** (F5 or Cmd+R) so the custom menu loads
3. In the menu bar, click **Data Searcher**
4. Choose:
   - **Enrich All Rows** – process all data rows
   - **Enrich Selected Rows** – process only the selected cells (select the rows first)

### Method B: From the Apps Script Editor

1. Open **Extensions → Apps Script** from your sheet
2. In the function dropdown, select **runEnrichment**
3. Click the **Run** button (▶)

---

## Part 5: During Execution

1. A popup appears: **“Enriching X rows. This may take a few minutes. Click OK to start.”**
2. Click **OK**
3. The script runs (about 1 second per row due to API rate limits)
4. Do not close the sheet or switch away for long; the script runs in the background
5. When done, a popup appears: **“Done! Enriched X of Y rows.”**
6. Click **OK**

---

## Part 6: View Results

1. Switch to the Google Sheet tab
2. New columns appear to the right of your data:
   - **Address**
   - **City_Enriched**
   - **State_Enriched**
   - **Zip**
   - **Phone**
   - **Email**
3. Scroll right to see the enriched data

---

## Part 7: Troubleshooting

### “Could not find Name, City, State columns”

- Row 1 must contain headers with “name”, “city”, and “state” (case-insensitive)
- Check for typos or extra spaces

### “Need at least a header row and one data row”

- Add at least one data row below the header

### “Serper API error”

- Check your Serper API key in the script
- Confirm you have remaining quota at [serper.dev](https://serper.dev)

### Data Searcher menu doesn’t appear

- Refresh the sheet (F5 or Cmd+R) after adding the script
- The menu is created by `onOpen()` when the sheet is opened

### Script runs but no data changes

- Ensure you opened Apps Script from the correct sheet (**Extensions → Apps Script** from that sheet)
- The script works on the **active sheet** (the tab you have selected)

### “Authorization required” again

- You may have revoked access
- The script may have been updated and now needs new permissions
- Re-run the authorization flow (Part 3.3)

---

## Part 8: Current Apps Script Notes (February 2026)

- **V8 runtime:** Rhino was deprecated in February 2025; scripts should use V8. New projects use V8 by default.
- **Granular OAuth:** As of January 2025, you can choose which permissions to grant when authorizing.
- **Bound scripts:** This script is “bound” to your sheet. It does not appear as a separate file in Drive and cannot be detached.
- **Execution limits:** Apps Script has quotas (e.g. runtime per execution). For large datasets, consider the Python script instead.

---

## Quick Reference

| Action              | Steps                                                                 |
|---------------------|-----------------------------------------------------------------------|
| Open Apps Script    | Extensions → Apps Script                                             |
| Run from editor     | Select `runEnrichment` → Click Run (▶)                              |
| Run from sheet      | Data Searcher → Enrich All Rows (or Enrich Selected Rows)             |
| First-time auth     | Review permissions → Choose account → Advanced → Go to project → Allow |
| View results        | New columns (Address, Zip, Phone, Email, etc.) to the right           |

---

## Alternative: Python Script (Recommended if Apps Script fails)

**See `TERMINAL_QUICKSTART.md` for full instructions.** Quick version:

1. Export your sheet as CSV: **File → Download → Comma-separated values (.csv)**
2. Set `SERPER_API_KEY` in a `.env` file (get key at serper.dev)
3. Run: `python3 enrich_contacts.py your_export.csv enriched_output.csv`
4. Import the result: **File → Import → Upload** and select `enriched_output.csv`

The Python script is tested and works. Use it if Apps Script keeps failing.
