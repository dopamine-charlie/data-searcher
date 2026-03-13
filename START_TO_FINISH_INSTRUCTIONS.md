# Data Searcher — Start to Finish Instructions

Copy-paste these steps. One-time setup first, then run/stop each time you use the app.

---

## ONE-TIME SETUP (do this once)

### Step 1: Open Terminal

- On Mac: Press `Cmd + Space`, type `Terminal`, press Enter.
- Or: Applications → Utilities → Terminal.

### Step 2: Go to the project folder

Copy and paste this, then press Enter:

```
cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
```

### Step 3: Create virtual environment (if it doesn't exist)

Copy and paste this, then press Enter:

```
python3 -m venv venv
```

You only need to do this once. If you see "venv already exists" or similar, that's fine.

### Step 4: Install dependencies

Copy and paste this, then press Enter:

```
source venv/bin/activate && pip install -r requirements.txt
```

Wait for it to finish. You should see "Successfully installed..." at the end.

### Step 5: Set up your Serper API key (for Serper mode)

1. Go to https://serper.dev and sign up (free tier: 2,500 queries/month).
2. Create an API key in the dashboard.
3. In the project folder, create a file named `.env` (or copy from `.env.example`).
4. Put this line in `.env`, replacing with your real key:

```
SERPER_API_KEY=your_actual_key_here
```

Save the file. You only need to do this once.

---

## EVERY TIME YOU WANT TO USE THE APP

### Step 1: Open Terminal

- On Mac: Press `Cmd + Space`, type `Terminal`, press Enter.

### Step 2: Go to the project folder

Copy and paste this, then press Enter:

```
cd "/Users/luizaprestonrobinett/Desktop/Dev/Cursor Apps/Data Searcher"
```

### Step 3: Start the server

Copy and paste this, then press Enter:

```
bash run_web.sh
```

### Step 4: Verify it's running

Look at the Terminal output. You should see something like:

```
  Data Searcher → http://127.0.0.1:5001
  Open that URL in your browser. Press Ctrl+C to stop.

 * Serving Flask app 'app'
 * Debug mode: on
 * Running on http://127.0.0.1:5001
Press CTRL+C to quit
```

If you see "Running on http://127.0.0.1:5001", the server is running. **Leave this Terminal window open.** Do not close it.

### Step 5: Open the app in your browser

1. Open Chrome, Safari, or any browser.
2. In the address bar, type or paste:

```
http://127.0.0.1:5001
```

3. Press Enter.

You should see the Data Searcher upload page. If you see "Connection refused" or "Can't reach this page", the server is not running — go back to Step 3.

### Step 6: Use the app

1. Drop your CSV file or click to browse.
2. Map columns (Name or First+Last, City, State).
3. Choose enrichment mode (DuckDuckGo + Serper fallback, Serper only, or DuckDuckGo only).
4. Click "Enrich contacts".
5. Wait for it to finish, then download the enriched CSV.

---

## WHEN YOU'RE DONE — STOP THE SERVER

### Step 1: Go back to the Terminal window where the server is running

Click on that Terminal window. It should still be showing the Flask output.

### Step 2: Stop the server

Press **Ctrl + C** on your keyboard.

- On Mac: Hold the `Control` key and press `C`.

### Step 3: Confirm it stopped

The Terminal should show a new prompt (like `$` or your username). The server is no longer running. You can close the Terminal window if you want.

---

## QUICK REFERENCE

| Action | Command or step |
|--------|-----------------|
| **One-time setup** | Steps 1–5 under ONE-TIME SETUP |
| **Start server** | `cd` to project folder, then `bash run_web.sh` |
| **Check if running** | Look for "Running on http://127.0.0.1:5001" in Terminal |
| **Open in browser** | http://127.0.0.1:5001 |
| **Stop server** | In the Terminal window, press **Ctrl + C** |

---

## TROUBLESHOOTING

| Problem | What to do |
|---------|------------|
| "Command not found: python3" | Install Python from python.org or try `python` instead of `python3` |
| "Permission denied: ./run_web.sh" | Use `bash run_web.sh` instead |
| "Connection refused" at 127.0.0.1:5001 | Server isn't running. Start it with `bash run_web.sh` |
| "Access denied" or 403 at 127.0.0.1:5000 | You're on the wrong port. Use 5001, not 5000 |
| "SERPER_API_KEY not set" | Create `.env` file with your key (see Step 5 of setup) |
