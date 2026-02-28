# Two Separate Scripts: Serper + TracerFY

Two independent Apps Scripts. Run Serper first, review the data, then optionally run TracerFY on rows you select.

**End goal:** Phone numbers and emails for everyone. Serper gets what it can. You decide what to run through TracerFY.

---

## Script 1: Serper (run first)

**File:** `SerperEnrichment.gs`

- **Input:** Name, City, State (row 1 = headers)
- **Query:** "John Doe, Roanoke, Virginia address phone email"
- **Output:** Address, Phone, Email, Website, Source_URL, Last_Checked

**Menu:** Serper
- Enrich All Rows
- Enrich Selected Rows
- Enrich Empty Rows Only (skip rows that already have data)
- Settings → Set API Key
- Settings → Validate Key

**Script Properties:** SERPER_API_KEY, SERPER_ENDPOINT, BATCH_SIZE, REQUEST_DELAY_MS, MAX_RETRIES

---

## Script 2: TracerFY (run after you review Serper results)

**File:** `TracerFYEnrichment.gs`

- **Input:** Same sheet. Reads Name, City, State + Serper output (Address, Phone, Email, Website).
- **Output:** Writes back to the same columns, filling blanks or adding data from TracerFY.

**Menu:** TracerFY
- Enrich Selected Rows (you select which rows to run)
- Settings → Set API Key & Endpoint
- Settings → Validate Key

**Script Properties:** TRACERFY_API_KEY, TRACERFY_ENDPOINT, TRACERFY_MODE (DRY_RUN or LIVE), BATCH_SIZE, REQUEST_DELAY_MS, MAX_RETRIES

---

## Setup

### Serper only

1. Extensions → Apps Script
2. Add `Code.gs` (paste contents) and `SerperEnrichment.gs` (paste contents)
3. Save. Refresh the sheet. You’ll see the **Serper** menu
4. Serper → Settings → Set API Key
5. Run Serper → Enrich All Rows

### Serper + TracerFY

1. Extensions → Apps Script
2. Add `Code.gs`, `SerperEnrichment.gs`, and `TracerFYEnrichment.gs` (paste contents of each)
3. Save. Refresh the sheet. You’ll see **Serper** and **TracerFY** menus
4. Serper → Settings → Set API Key
5. TracerFY → Settings → Set API Key & Endpoint (when ready)

---

## Workflow

1. **Run Serper** on your list (All, Selected, or Empty Rows).
2. **Review** the results. Check how many rows have phone/email.
3. **Decide** which rows need TracerFY (e.g. rows with Address but missing phone/email).
4. **Select** those rows.
5. **Run TracerFY** → Enrich Selected Rows.
6. Rows with nothing from Serper (no address, phone, or email) → skip or handle separately.

---

## Notes

- Serper and TracerFY are independent. You can use Serper without ever running TracerFY.
- TracerFY in DRY_RUN mode does not call the API; use it to test the flow.
- Both scripts use the same output columns, so TracerFY can add to or overwrite Serper data.
