@echo off
rem Build Relay (when needed) and open it.
rem Double-click this file. Details: getting-started\README.md
setlocal
cd /d "%~dp0..\.."
call "%~dp0..\scripts\check-node.cmd" || goto :end
node "%~dp0..\scripts\helper.mjs" start
:end
echo.
pause
