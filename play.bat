@echo off
title FORMICARIUM :: DEEP COLONY
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found - opening the game directly in your browser instead.
  start "" "%~dp0index.html"
  exit /b
)
start "" http://localhost:8137
node "%~dp0tools\serve.js" 8137
