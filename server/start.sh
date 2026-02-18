#!/bin/bash
# Start usage API server with env
DIR="$(cd "$(dirname "$0")" && pwd)"
set -a
source "$DIR/.env"
set +a
export MOONSHOT_API_KEY="${MOONSHOT_API_KEY:-$(python3 -c "
import json, os, re
with open(os.path.expanduser('~/.openclaw/openclaw.json')) as f:
    c = json.load(f)
raw = c.get('env',{}).get('MOONSHOT_API_KEY','')
m = re.match(r'^\\\$\{(.+)\}$', raw)
print(os.environ.get(m.group(1), '') if m else raw)
" 2>/dev/null)}"

exec node "$DIR/usage-server.js"
