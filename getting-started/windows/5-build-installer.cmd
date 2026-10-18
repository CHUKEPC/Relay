@echo off
rem Build an installer for this computer.
rem Double-click this file. Details: getting-started\README.md
setlocal
cd /d "%~dp0..\.."
call "%~dp0..\scripts\check-node.cmd" || goto :end
node "%~dp0..\scripts\helper.mjs" package
:end
echo.
pause
