# ADB File Explorer

A Windows application for managing files on Android devices via ADB (Android Debug Bridge).

## Features

- 📱 Connect to Android devices via ADB
- 📁 Browse files on your Android device
- ⬆️ Upload files from PC to device
- ⬇️ Download files from device to PC
- 🗑️ Delete files and folders
- 📂 Create new folders
- 🔄 Dual-pane file explorer interface

## Prerequisites

1. **ADB (Android Debug Bridge)** must be installed and available in your system PATH
   - Download from [Android SDK Platform Tools](https://developer.android.com/studio/releases/platform-tools)
   - Or install via: `winget install Google.PlatformTools`

2. **Python 3.10+** for the backend

3. **Node.js 18+** for the frontend

4. **USB Debugging** enabled on your Android device
   - Go to Settings > Developer Options > USB Debugging

## Project Structure

```
adb-fx/
├── backend/           # Python FastAPI backend
│   ├── app/
│   │   ├── main.py    # FastAPI application
│   │   ├── adb.py     # ADB wrapper module
│   │   ├── models.py  # Pydantic models
│   │   └── routes/    # API routes
│   └── requirements.txt
├── frontend/          # React Vite frontend
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── services/
│   └── package.json
└── README.md
```

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List connected devices |
| GET | `/api/devices/{id}/files` | List files in directory |
| POST | `/api/devices/{id}/files/upload` | Upload file to device |
| GET | `/api/devices/{id}/files/download` | Download file from device |
| DELETE | `/api/devices/{id}/files` | Delete file or folder |
| POST | `/api/devices/{id}/files/mkdir` | Create directory |

## License

MIT
