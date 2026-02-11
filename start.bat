@echo off
echo ========================================
echo   ADB File Explorer - Full Start
echo ========================================
echo.
echo Starting backend and frontend...
echo.

start "ADB-FX Backend" cmd /c "%~dp0start-backend.bat"
timeout /t 3 /nobreak >nul
start "ADB-FX Frontend" cmd /c "%~dp0start-frontend.bat"

echo.
echo Both servers are starting...
echo.
echo Backend API: http://localhost:8000/api/docs
echo Frontend UI: http://localhost:5173
echo.
echo Press any key to exit this window...
pause >nul
