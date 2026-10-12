@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo    KaiTuoYiShi - Local Launcher
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo Node.js detected: %NODEV%
echo.

if exist "node_modules\" goto RUN

echo First launch: installing dependencies (needs internet, may take a few minutes)...
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
where corepack >nul 2>nul
if errorlevel 1 (
  call npm install
) else (
  call corepack pnpm install
  if errorlevel 1 call npm install
)
if errorlevel 1 goto INSTALLFAIL
echo.

:RUN
echo Starting local server...
start "KaiTuoYiShi Server" cmd /k "corepack pnpm dev || pnpm dev || npm run dev"
timeout /t 6 /nobreak >nul
start "" "http://localhost:3000"
echo.
echo Server started. If the browser did not open, please visit: http://localhost:3000
echo Open Settings in the game and fill in your own model API to start playing.
echo Close the "KaiTuoYiShi Server" window to stop the server.
echo.
pause
exit /b 0

:NONODE
echo [ERROR] Node.js not found.
echo Please install Node.js 20 LTS or later from: https://nodejs.org/
echo Then run this file again.
echo.
pause
exit /b 1

:INSTALLFAIL
echo.
echo [ERROR] Dependency installation failed. Please check your network and retry.
echo.
pause
exit /b 1
