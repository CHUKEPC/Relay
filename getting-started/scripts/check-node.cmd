@echo off
rem Called by the numbered scripts: makes sure Node.js is installed.
rem The version itself (20 or newer) is checked by helper.mjs, which explains what to do.
where node >nul 2>nul
if not errorlevel 1 exit /b 0
chcp 65001 >nul
echo.
echo  Node.js is not installed. It is needed to build and run Relay.
echo  Node.js не установлен. Он нужен, чтобы собрать и запустить Relay.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :manual
choice /c YN /m "Install Node.js LTS now? / Установить Node.js сейчас?"
if errorlevel 2 goto :manual
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
echo.
echo  Close this window and run the script again.
echo  Закройте это окно и запустите скрипт ещё раз.
exit /b 1
:manual
echo  Opening https://nodejs.org - download the LTS version, install it and run this script again.
echo  Открываю https://nodejs.org - скачайте версию LTS, установите её и запустите скрипт ещё раз.
start "" "https://nodejs.org/en/download"
exit /b 1
