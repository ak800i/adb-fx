# ADB File Explorer (adb-fx)

A local-first desktop web app for managing files on Android devices via ADB.

## Architecture

- **Backend**: Python 3.14, FastAPI, uvicorn
- **Frontend**: React + TypeScript + Vite, CSS Modules, lucide-react icons
- **ADB**: v36.0.2, bundled in `platform-tools/` for zero-setup

Both run on the same machine. The frontend is a thin UI shell — all file operations happen directly on the backend via `adb push`/`adb pull` with local filesystem paths. **No files ever transfer over HTTP.**

## Zero-Setup Experience

```
git clone → start.bat → done
```

`start.bat` creates a Python venv, installs deps, starts both servers. ADB is bundled — no Android SDK required.

The only prerequisites are:

- **Python 3.10+**
- **Node.js 18+**
- **USB Debugging** enabled on your Android device

## Features

- **Device sidebar**: Auto-discovers connected USB devices (polls every few seconds)
- **File browser**: Navigate device filesystem, path bar with manual entry, back/up/home buttons
- **Upload**: Local file picker browses the Windows filesystem (drives, folders, files) → backend pushes directly to device
- **Download**: Select device files → local folder picker → backend pulls directly to that folder
- **New folder**, **Delete** (with confirmation), **Rename**
- **Cancellable transfers**: Push/pull operations can be cancelled mid-transfer via a stop button on the toast notification
- **URL hash persistence**: Current path stored in `#/sdcard/...` — survives page refresh, supports back/forward

## Design

- Dark theme (deep navy/indigo palette: `#1a1a2e`, `#16213e`, `#0f3460`)
- Android green accent (`#3DDC84`)
- Sidebar (300px) + main content layout
- Toasts for operation feedback (success/error with auto-dismiss)
- Custom local file picker modal with drive buttons, breadcrumb navigation, file selection
- Responsive breakpoints at 900px, 800px, 600px

## Key Design Decision

The backend has full access to both the local filesystem and ADB, so file transfers are **single-hop**: local disk ↔ device. The frontend never touches file bytes — it only sends paths as strings in API calls.

## Project Structure

```
adb-fx/
├── platform-tools/        # Bundled ADB (adb.exe + DLLs)
├── backend/               # Python FastAPI backend
│   ├── app/
│   │   ├── main.py        # FastAPI application entry point
│   │   ├── adb.py         # ADB wrapper (async subprocess)
│   │   ├── models.py      # Pydantic models
│   │   └── routes/
│   │       ├── devices.py # Device discovery endpoints
│   │       ├── files.py   # File operations (push/pull/mkdir/delete)
│   │       └── local.py   # Local filesystem browsing
│   └── requirements.txt
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── App.tsx        # Main application component
│   │   ├── types.ts       # TypeScript type definitions
│   │   ├── components/    # UI components (Toolbar, FileList, LocalFilePicker, etc.)
│   │   ├── hooks/         # React hooks (useDevices, useFileBrowser)
│   │   └── services/
│   │       └── api.ts     # Backend API client
│   └── package.json
├── start.bat              # One-click launcher (backend + frontend)
├── start-backend.bat      # Backend-only launcher
├── start-frontend.bat     # Frontend-only launcher
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List connected devices |
| GET | `/api/devices/{id}/files` | List files in directory |
| POST | `/api/devices/{id}/files/push` | Push local file/folder to device |
| POST | `/api/devices/{id}/files/pull` | Pull device file to local directory |
| POST | `/api/devices/{id}/files/mkdir` | Create directory on device |
| DELETE | `/api/devices/{id}/files` | Delete file or folder |
| POST | `/api/devices/{id}/files/rename` | Rename/move file or folder |
| POST | `/api/devices/{id}/files/cancel` | Cancel an in-progress transfer |
| GET | `/api/local/drives` | List Windows drive letters |
| GET | `/api/local/list` | Browse local directory contents |

## License

MIT
