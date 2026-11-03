@echo off
rem Restart Arn Reels: stop the old server, then start with the latest code (use after editing server.js or lib/)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
timeout /t 2 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
