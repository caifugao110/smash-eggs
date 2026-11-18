@echo off
title Smash Eggs - Local Child Voice Server
cd /d "%~dp0"

set "PY=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" -c "import edge_tts" >nul 2>&1
if errorlevel 1 (
  echo Installing voice dependency edge-tts...
  echo.
  "%PY%" -m pip install edge-tts --index-url https://pypi.org/simple
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install edge-tts. Check your network and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting server... Keep this window open while playing.
echo.
"%PY%" server.py
echo.
echo Server stopped.
pause
