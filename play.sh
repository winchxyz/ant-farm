#!/usr/bin/env sh
# FORMICARIUM :: DEEP COLONY
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  (sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:8137) || (command -v open >/dev/null && open http://localhost:8137)) &
  exec node tools/serve.js 8137
else
  echo "Node.js not found - open index.html in your browser instead."
fi
