#!/bin/bash
# Data Searcher - Run enrichment from terminal
# Usage: ./run_enrich.sh input.csv output.csv
# Or:    bash run_enrich.sh input.csv output.csv

cd "$(dirname "$0")"

if [ ! -f ".env" ]; then
  echo "Error: Create a .env file with SERPER_API_KEY=your_key"
  echo "Copy .env.example to .env and add your key from https://serper.dev"
  exit 1
fi

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 input.csv output.csv"
  echo "Example: $0 my_list.csv enriched_list.csv"
  exit 1
fi

# Load .env
export $(grep -v '^#' .env | xargs)

python3 enrich_contacts.py "$1" "$2"
