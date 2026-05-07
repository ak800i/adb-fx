# AGENTS.md — ADB File Explorer (adb-fx)

## Project Overview

ADB File Explorer is a desktop web app for managing files on Android devices via ADB (Android Debug Bridge). It has a Python backend and a React frontend, launched together via batch scripts on Windows.

## Tech Stack

### Backend (`backend/`)

- **Language:** Python 3
- **Framework:** FastAPI (>=0.115.0)
- **Server:** Uvicorn (>=0.34.0) with standard extras
- **Data validation:** Pydantic v2 (>=2.10.0)
- **Async file I/O:** aiofiles (>=24.1.0)
- **File uploads:** python-multipart (>=0.0.18)
- **ADB integration:** Wraps the `adb` CLI via `subprocess`/`asyncio.create_subprocess_exec`
- **API docs:** Swagger UI at `/api/docs`, ReDoc at `/api/redoc`
- **CORS:** Configured for Vite dev server origins (localhost:5173, localhost:3000)

### Frontend (`frontend/`)

- **Language:** TypeScript (strict mode, ES2020 target)
- **UI library:** React 18
- **Build tool:** Vite 5 with `@vitejs/plugin-react`
- **Icons:** lucide-react
- **Virtualized lists:** react-window
- **Styling:** CSS Modules (`*.module.css`)
- **API communication:** Native `fetch` (no Axios/etc.)
- **Path alias:** `@/` → `src/`
- **Dev server:** Vite on port 5173, proxies `/api` to backend on port 8000

### Platform Tools (`platform-tools/`)

- Contains the ADB executable (Android SDK Platform Tools), resolved at runtime by the backend.

### Project Layout

```
backend/app/main.py      — FastAPI app entrypoint
backend/app/adb.py        — ADB subprocess wrapper
backend/app/models.py     — Pydantic models
backend/app/routes/       — API route modules (devices, files, local)
frontend/src/App.tsx       — Root React component
frontend/src/services/api.ts — Backend API client
frontend/src/hooks/        — Custom React hooks (useDevices, useFileBrowser)
frontend/src/components/   — UI components (FileList, Toolbar, TransferQueue, etc.)
frontend/src/types.ts      — Shared TypeScript types
```

### Running

- `start.bat` — Launches both backend and frontend
- `start-backend.bat` — Backend only (Uvicorn on port 8000)
- `start-frontend.bat` — Frontend only (Vite on port 5173)
