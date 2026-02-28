# Enrichment Apps Script – Setup

## 1. Add the script

1. Open your Google Sheet.
2. **Extensions → Apps Script**.
3. Delete any existing code in `Code.gs`.
4. Paste the full contents of `Enrichment.gs`.
5. Save (Ctrl+S / Cmd+S).

## 2. Script Properties (no hardcoded keys)

Set via **Enrichment → Settings → Set/Update API Keys**, or in **Project Settings → Script Properties**:

| Property | Default | Description |
|----------|---------|-------------|
| SERPER_API_KEY | (required) | Serper API key from serper.dev |
| SERPER_ENDPOINT | https://google.serper.dev/search | Serper API URL |
| TRACERFY_API_KEY | (optional) | TracerFY API key |
| TRACERFY_ENDPOINT | (blank) | TracerFY API URL |
| TRACERFY_MODE | DRY_RUN | DRY_RUN or LIVE |
| BATCH_SIZE | 25 | Rows per run |
| CONFIDENCE_THRESHOLD | 60 | 0–100; rows above this go to TracerFY |
| REQUEST_DELAY_MS | 250 | Delay between API calls |
| MAX_RETRIES | 5 | Retries for 429/5xx |

## 3. Input headers (row 1)

- **Name** (or **First Name** + **Last Name**)
- **City**
- **State**

Headers are matched case-insensitively.

## 4. Output headers (auto-created if missing)

- Address, Phone, Email, Website, Source_URL, Confidence, Status, Last_Checked

## 5. Status values

- PENDING_SERPER → DONE_SERPER or FAIL_SERPER
- PENDING_TRACER → DONE_TRACER or FAIL_TRACER

## 6. Run from the Enrichment menu

1. Refresh the sheet (F5) so the menu appears.
2. **Enrichment** menu:
   - **Serper → Enrich Selected Rows** – selected rows only
   - **Serper → Enrich Pending Rows** – all PENDING_SERPER rows
   - **TracerFY → Enrich Selected Rows** – selected rows only
   - **TracerFY → Enrich Pending Rows** – all PENDING_TRACER rows
   - **Settings → Set/Update API Keys**
   - **Settings → Validate Keys**
   - **Utilities → Reset Status for Selected**
   - **Utilities → Reset Status for All Rows**

## 7. First run

1. **Enrichment → Settings → Set/Update API Keys** – enter SERPER_API_KEY.
2. **Enrichment → Settings → Validate Keys** – confirm Serper works.
3. Run **Serper → Enrich Pending Rows** (or Enrich Selected Rows).

## 8. Logging

An **Enrichment_Log** sheet is created automatically. It logs timestamp, sheet, row, stage, status, message, and a short response snippet.
