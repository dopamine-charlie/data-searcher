# Data Searcher

Enrich a CSV of **Name, City, State** with address, phone, and email by Google-searching each row via the [SERPER.dev](https://serper.dev) API and extracting contact info from the results.

## Quick start (web app)

### Start the server

1. Open Terminal.
2. Go to the project folder:
   ```bash
   cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
   ```
3. Run:
   ```bash
   ./run_web.sh
   ```

### How to tell if it's running

- **In the terminal:** You should see something like:
  ```
  Starting Data Searcher at http://127.0.0.1:5001
  * Running on http://127.0.0.1:5001
  * Debug mode: on
  ```
  If you see that, the server is running. **Leave that terminal window open.** Closing it stops the server.

- **In the browser:** Open **http://127.0.0.1:5001**. You should see the Data Searcher upload page. If you get "Connection refused" or "Can't reach this page", the server isn't running.

### Stop the server

In the terminal where it's running, press **Ctrl+C**.

### Change the port

Edit `app.py` and change `port=5001` on the last line to another port (e.g. `port=8080`). Restart the server.

## Why This Exists

- **Skip tracers** (Tracer Fire, etc.) usually need full address (street, city, state, zip).
- **People search sites** (True People Search, etc.) don’t offer public APIs.
- **Google search** often surfaces addresses, phones, and emails in snippets.
- This script automates: CSV → Google search (via SERPER) → extract → enriched CSV.

## Setup

1. **Get a SERPER API key** (free tier: 2,500 queries)
   - Sign up at [serper.dev](https://serper.dev)
   - Create an API key in the dashboard

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set your API key**
   ```bash
   export SERPER_API_KEY="your-api-key-here"
   ```

## Usage

```bash
# Basic: input.csv → output.csv (expects columns: Name, City, State)
python3 enrich_contacts.py input.csv output.csv

# Custom column names
python3 enrich_contacts.py input.csv output.csv --name-col "Full Name" --city-col "City" --state-col "State"

# Limit to first 10 rows (for testing)
python3 enrich_contacts.py input.csv output.csv --limit 10

# Slower rate (if you hit rate limits)
python3 enrich_contacts.py input.csv output.csv --delay 2.0
```

## Input CSV Format

| Name         | City        | State |
|--------------|-------------|-------|
| John Smith   | Springfield | IL    |
| Jane Doe     | Austin      | TX    |

Column names are configurable via `--name-col`, `--city-col`, `--state-col`.

## Output

The script adds these columns to your CSV:

- **Address** – Street address (when found in snippets)
- **City_Enriched** – City (from original or extracted)
- **State_Enriched** – State (from original or extracted)
- **Zip** – ZIP code
- **Phone** – Phone number
- **Email** – Email address

## Expected Results

- **Phone & email**: Usually 30–60% hit rate from snippets (regex extraction).
- **Address**: Harder to extract reliably; success varies.
- Rows that are still missing data can be run through Tracer Fire or another skip tracer once you have enough fields.

## Next Steps

1. Run this script on your CSV.
2. Review the enriched output.
3. For rows still missing address/phone/email, use Tracer Fire or another skip tracer if you now have enough data (e.g., full address).
