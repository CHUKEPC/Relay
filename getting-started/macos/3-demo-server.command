#!/usr/bin/env bash
# Run the demo service for the examples (keep the window open).
# Double-click this file (the first time: right-click → Open).
# Details: getting-started/README.md
cd "$(dirname "$0")/../.." || exit 1
if . "getting-started/scripts/check-node.sh"; then
  node getting-started/scripts/helper.mjs demo
fi
echo
read -n 1 -s -r -p "Press any key to close / Нажмите любую клавишу, чтобы закрыть"
