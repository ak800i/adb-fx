@echo off
echo ========================================
echo   ADB File Explorer - Frontend Setup
echo ========================================
echo.

cd /d "%~dp0frontend"

echo Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

echo Installing dependencies...
if not exist "node_modules" (
    npm install
)

echo.
echo ========================================
echo   Starting Frontend on port 5173
echo ========================================
echo.
echo Open http://localhost:5173 in your browser
echo.

npm run dev
