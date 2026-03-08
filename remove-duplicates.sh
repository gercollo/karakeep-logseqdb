#!/bin/bash

# Script to find and remove duplicate bookmarks
# Usage: ./remove-duplicates.sh

API_URL="http://127.0.0.1:12315/api"
TOKEN="test123"

echo "Finding duplicate bookmarks..."

# Get all bookmarks with their UUIDs and URLs
query='[:find ?uuid ?url :where [?b :block/page ?p] [?p :block/title "Bookmarks"] [?b :block/uuid ?uuid] [?b :user.property/url-xlm_xRT0 ?urlEntity] [?urlEntity :block/title ?url]]'

# Create temp file for query
cat > /tmp/query.json << EOF
{
  "method": "logseq.DB.datascriptQuery",
  "args": ["$query"]
}
EOF

# Get the data
response=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer $TOKEN" \
  -d @/tmp/query.json)

echo "$response" | python3 -c "
import sys, json
from collections import defaultdict

data = json.load(sys.stdin)

# Group by URL
urls = defaultdict(list)
for item in data:
    uuid, url = item
    urls[url].append(uuid)

# Find duplicates
duplicates = {url: uuids for url, uuids in urls.items() if len(uuids) > 1}

if not duplicates:
    print('No duplicates found!')
    sys.exit(0)

print(f'Found {len(duplicates)} URLs with duplicates:')
print()

for url, uuids in duplicates.items():
    print(f'URL: {url}')
    print(f'  Count: {len(uuids)}')
    for i, uuid in enumerate(uuids):
        print(f'  [{i}] {uuid}')
    print()

# Generate delete commands (keeping first occurrence)
print('Commands to delete duplicates (keeping first):')
print()
for url, uuids in duplicates.items():
    for uuid in uuids[1:]:  # Skip first one
        print(f'logseq delete-block {uuid}')
"