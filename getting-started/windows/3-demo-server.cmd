@echo off
rem Run the demo service for the examples (keep the window open).
rem Double-click this file. Details: getting-started\README.md
setlocal
cd /d "%~dp0..\.."
call "%~dp0..\scripts\check-node.cmd" || goto :end
node "%~dp0..\scripts\helper.mjs" demo
:end
echo.
pause
