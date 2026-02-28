#!/bin/bash
# Run the Data Searcher web app
cd "$(dirname "$0")"
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt -q
echo ""
echo "  Data Searcher → http://127.0.0.1:5001"
echo "  Open that URL in your browser. Press Ctrl+C to stop."
echo ""
python app.py
