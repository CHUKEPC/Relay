# Sourced by the numbered scripts: makes sure Node.js is installed.
# The version itself (20 or newer) is checked by helper.mjs, which explains what to do.
if ! command -v node >/dev/null 2>&1; then
  echo
  echo " Node.js is not installed. It is needed to build and run Relay."
  echo " Node.js не установлен. Он нужен, чтобы собрать и запустить Relay."
  echo
  if [ "$(uname)" = "Darwin" ]; then
    echo " Opening https://nodejs.org - download the LTS installer (.pkg), install it and run this script again."
    echo " Открываю https://nodejs.org - скачайте установщик LTS (.pkg), установите и запустите скрипт ещё раз."
    open "https://nodejs.org/en/download" 2>/dev/null
  else
    echo " Install it with nvm (the way nodejs.org recommends), in a terminal:"
    echo " Установите через nvm (так советует nodejs.org), в терминале:"
    echo
    echo "   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "   # close the terminal, open a new one / закройте терминал и откройте новый"
    echo "   nvm install --lts"
    echo
    echo " Then run this script again. / Затем запустите этот скрипт ещё раз."
  fi
  return 1 2>/dev/null || exit 1
fi
