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
- **Cancellable transfers**: Push/pull operations can be cancelled mid-transfer via a stop button in the transfer queue
- **Transfer queue panel**: A persistent, collapsible panel pinned to the bottom of the viewport (like a browser download manager). Active transfers show real-time progress bars, transfer speed (KB/s or MB/s), and cancel buttons; completed/failed/cancelled transfers remain visible until explicitly dismissed or cleared. Unlike ephemeral toast notifications, the transfer queue cannot be accidentally dismissed or auto-hidden during a long transfer.
- **Serial transfer queue**: Transfers are processed one at a time. If additional files or folders are added while a transfer is in progress, they are queued (shown as "Queued" in the transfer panel) and executed sequentially — never in parallel. This prevents ADB contention and ensures predictable behaviour.
- **Transfer progress bar**: Real-time progress tracked by monitoring destination file size growth during transfers (ADB suppresses progress output in non-TTY pipes). Polled every 500ms for pulls, 1s for pushes. Progress endpoint also returns transfer speed (bytes/sec), not just percentage
- **Transfer speed**: Displayed in the transfer queue as an exponentially-weighted moving average (smoothed), updated on each progress poll. Speed is computed on the backend from byte-count deltas between poll intervals.
- **URL hash persistence**: Current path stored in `#/sdcard/...` — survives page refresh, supports back/forward. Path segments are properly percent-encoded so folders with spaces or special characters (e.g. `F1 (2025)`) work correctly.
- The file picker remembers last browsed path across sessions (survives page close)

## Design

- Dark theme (deep navy/indigo palette: `#1a1a2e`, `#16213e`, `#0f3460`)
- Android green accent (`#3DDC84`)
- Sidebar (300px) + main content layout
- Toasts for simple operation feedback (success/error with auto-dismiss)
- Transfer queue panel (bottom of content area) for persistent progress tracking
- Custom local file picker modal with drive buttons, breadcrumb navigation, file selection
- Responsive breakpoints at 900px, 800px, 600px

## Key Design Decision

The backend has full access to both the local filesystem and ADB, so file transfers are **single-hop**: local disk ↔ device. The frontend never touches file bytes — it only sends paths as strings in API calls.

## Technical Notes

### Transfer Progress

ADB **suppresses progress output** when stdout/stderr are pipes (only writes progress to a real TTY). Attempts to read progress incrementally from pipes — including unbuffered raw reads — yield nothing until the transfer completes.

**Workaround**: Progress is tracked by monitoring destination file size growth:
- **Pull** (device → local): A daemon thread polls `os.path.getsize(local_path)` every **500ms** against the remote file size (obtained upfront via `adb shell stat`)
- **Push** (local → device): A daemon thread polls `adb shell stat -c %s '<remote_path>'` every **1s** (longer interval due to ADB shell round-trip cost) against `os.path.getsize(local_path)`

Progress is capped at 99% until the ADB process actually exits successfully.

**Transfer speed** is calculated in the same monitor thread using an exponential moving average (EMA, α=0.3) of byte-count deltas between poll intervals. This smooths out jitter from filesystem caching and ADB shell round-trip variance. The speed (bytes/sec) is returned alongside progress in the `/progress` endpoint and displayed in the transfer queue UI as KB/s or MB/s.

**Path quoting**: Remote paths passed to `adb shell stat` must be wrapped in single quotes with internal single quotes escaped (`'` → `'\''`), since `adb shell` concatenates all args into a single shell command string. Without this, paths containing spaces or parentheses (e.g. `F1 (2025)`) cause `stat` to fail silently.

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
│   │   ├── components/    # UI components (Toolbar, FileList, TransferQueue, LocalFilePicker, etc.)
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
| GET | `/api/devices/{id}/files/progress` | Get transfer progress (0-100%), speed (bytes/s) |
| GET | `/api/local/drives` | List Windows drive letters |
| GET | `/api/local/list` | Browse local directory contents |

## License

MIT
