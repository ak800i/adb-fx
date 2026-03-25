"""
Routes for browsing the local filesystem.
Allows the frontend to navigate local files/folders so the backend
can push/pull directly without an intermediate HTTP file transfer.
"""
import asyncio
import os
import string
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/api/local", tags=["local"])


class LocalEntry(BaseModel):
    name: str
    path: str
    type: str  # "file" or "directory"
    size: Optional[int] = None


class LocalListResponse(BaseModel):
    path: str
    parent: Optional[str]
    entries: List[LocalEntry]


@router.get("/drives")
async def list_drives():
    """List available drive letters (Windows)."""
    drives = []
    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        if os.path.exists(drive):
            drives.append(drive)
    return drives


@router.get("/list", response_model=LocalListResponse)
async def list_local(path: str = Query(..., description="Local directory path")):
    """List contents of a local directory."""
    path = os.path.normpath(path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {path}")

    entries: List[LocalEntry] = []
    try:
        for name in sorted(os.listdir(path), key=str.lower):
            full = os.path.join(path, name)
            try:
                is_dir = os.path.isdir(full)
            except OSError:
                continue
            entry_type = "directory" if is_dir else "file"
            size = None
            if not is_dir:
                try:
                    size = os.path.getsize(full)
                except OSError:
                    pass
            entries.append(LocalEntry(name=name, path=full, type=entry_type, size=size))
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {path}")

    parent_path = str(Path(path).parent)
    if parent_path == path:
        parent_path = None

    return LocalListResponse(path=path, parent=parent_path, entries=entries)


def _open_folder_dialog(initial_dir: str, title: str) -> Optional[str]:
    """Open a native OS folder picker dialog. Must run on the main thread."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    folder = filedialog.askdirectory(
        initialdir=initial_dir if os.path.isdir(initial_dir) else None,
        title=title,
    )
    root.destroy()
    return folder or None


@router.get("/pick-folder")
async def pick_folder(
    initial_dir: str = Query("", description="Starting directory"),
    title: str = Query("Select Folder", description="Dialog title"),
):
    """Open a native OS folder selection dialog and return the chosen path."""
    selected = await asyncio.to_thread(_open_folder_dialog, initial_dir, title)
    if not selected:
        return {"path": None}
    return {"path": os.path.normpath(selected)}
