@echo off
echo ========================================
echo   ADB File Explorer - Backend Setup
echo ========================================
echo.

cd /d "%~dp0backend"

echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo Creating virtual environment...
if not exist "venv" (
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo ========================================
echo   Starting Backend Server on port 8000
echo ========================================
echo.
echo API Documentation: http://localhost:8000/api/docs
echo.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
