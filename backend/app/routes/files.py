"""
File operations routes.
"""
import os
import tempfile
import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse, StreamingResponse
from typing import Optional
from ..adb import adb, ADBError
from ..models import (
    FileListResponse, 
    OperationResult, 
    CreateDirectoryRequest,
    DeleteRequest,
    RenameRequest
)

router = APIRouter(prefix="/devices/{device_id}/files", tags=["files"])

# Temporary directory for file transfers
TEMP_DIR = os.path.join(tempfile.gettempdir(), "adb-fx")
os.makedirs(TEMP_DIR, exist_ok=True)


@router.get("", response_model=FileListResponse)
async def list_files(
    device_id: str,
    path: str = Query("/sdcard", description="Directory path to list")
):
    """List files and directories at the given path."""
    try:
        result = await adb.list_files(device_id, path)
        return result
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/download")
async def download_file(
    device_id: str,
    path: str = Query(..., description="File path on device to download")
):
    """Download a file from the device."""
    try:
        # Check if it's a file
        is_dir = await adb.is_directory(device_id, path)
        if is_dir:
            raise HTTPException(
                status_code=400, 
                detail="Cannot download a directory. Please select a file."
            )
        
        # Create temp file with unique name
        filename = os.path.basename(path)
        temp_path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}_{filename}")
        
        # Pull file from device
        await adb.pull_file(device_id, path, temp_path)
        
        # Return file as response
        return FileResponse(
            temp_path,
            filename=filename,
            media_type="application/octet-stream",
            background=None  # File will be cleaned up later
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/upload", response_model=OperationResult)
async def upload_file(
    device_id: str,
    file: UploadFile = File(...),
    path: str = Query(..., description="Destination directory on device")
):
    """Upload a file to the device."""
    try:
        # Save uploaded file to temp location
        temp_path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}_{file.filename}")
        
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        try:
            # Determine destination path
            if await adb.is_directory(device_id, path):
                remote_path = f"{path.rstrip('/')}/{file.filename}"
            else:
                remote_path = path
            
            # Push file to device
            await adb.push_file(device_id, temp_path, remote_path)
            
            return OperationResult(
                success=True,
                message=f"File uploaded successfully",
                path=remote_path
            )
        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/mkdir", response_model=OperationResult)
async def create_directory(
    device_id: str,
    request: CreateDirectoryRequest
):
    """Create a new directory on the device."""
    try:
        await adb.mkdir(device_id, request.path)
        return OperationResult(
            success=True,
            message="Directory created successfully",
            path=request.path
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("", response_model=OperationResult)
async def delete_file(
    device_id: str,
    path: str = Query(..., description="Path to delete"),
    recursive: bool = Query(False, description="Delete recursively")
):
    """Delete a file or directory on the device."""
    try:
        # Auto-detect if recursive is needed
        is_dir = await adb.is_directory(device_id, path)
        
        await adb.delete(device_id, path, recursive=recursive or is_dir)
        return OperationResult(
            success=True,
            message="Deleted successfully",
            path=path
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/rename", response_model=OperationResult)
async def rename_file(
    device_id: str,
    request: RenameRequest
):
    """Rename or move a file/directory on the device."""
    try:
        await adb.rename(device_id, request.old_path, request.new_path)
        return OperationResult(
            success=True,
            message="Renamed successfully",
            path=request.new_path
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/exists")
async def check_exists(
    device_id: str,
    path: str = Query(..., description="Path to check")
):
    """Check if a path exists on the device."""
    try:
        exists = await adb.file_exists(device_id, path)
        is_dir = await adb.is_directory(device_id, path) if exists else False
        return {
            "exists": exists,
            "is_directory": is_dir,
            "path": path
        }
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))
