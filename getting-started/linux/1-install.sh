#!/usr/bin/env bash
# Download the components Relay needs (once, about 750 MB).
# Run in a terminal: bash getting-started/linux/1-install.sh
# Details: getting-started/README.md
cd "$(dirname "$0")/../.." || exit 1
if . "getting-started/scripts/check-node.sh"; then
  node getting-started/scripts/helper.mjs install
fi
echo
[ -t 0 ] && read -n 1 -s -r -p "Press any key to close / Нажмите любую клавишу, чтобы закрыть"
