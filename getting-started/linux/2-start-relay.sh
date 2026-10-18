#!/usr/bin/env bash
# Build Relay (when needed) and open it.
# Run in a terminal: bash getting-started/linux/2-start-relay.sh
# Details: getting-started/README.md
cd "$(dirname "$0")/../.." || exit 1
if . "getting-started/scripts/check-node.sh"; then
  node getting-started/scripts/helper.mjs start
fi
echo
[ -t 0 ] && read -n 1 -s -r -p "Press any key to close / Нажмите любую клавишу, чтобы закрыть"
