@echo off
rem Download the components Relay needs (once, about 750 MB).
rem Double-click this file. Details: getting-started\README.md
setlocal
cd /d "%~dp0..\.."
call "%~dp0..\scripts\check-node.cmd" || goto :end
node "%~dp0..\scripts\helper.mjs" install
:end
echo.
pause
