@echo off
rem Run the automated tests.
rem Double-click this file. Details: getting-started\README.md
setlocal
cd /d "%~dp0..\.."
call "%~dp0..\scripts\check-node.cmd" || goto :end
node "%~dp0..\scripts\helper.mjs" test
:end
echo.
pause
