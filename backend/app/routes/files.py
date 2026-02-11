"""
File operations routes.
"""
import os
from fastapi import APIRouter, HTTPException, Query
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


@router.post("/push", response_model=OperationResult)
async def push_local(
    device_id: str,
    local_path: str = Query(..., description="Local file or directory path"),
    remote_path: str = Query(..., description="Destination path on device"),
    transfer_id: Optional[str] = Query(None, description="Transfer ID for cancellation"),
):
    """Push a local file or directory directly to the device (no HTTP transfer)."""
    try:
        if not os.path.exists(local_path):
            raise HTTPException(status_code=404, detail=f"Local path not found: {local_path}")

        # If pushing a file into a directory, append the filename
        if os.path.isfile(local_path):
            try:
                is_dir = await adb.is_directory(device_id, remote_path)
            except ADBError:
                is_dir = False
            if is_dir:
                remote_path = f"{remote_path.rstrip('/')}/{os.path.basename(local_path)}"

        await adb.push_file(device_id, local_path, remote_path, transfer_id=transfer_id)
        return OperationResult(
            success=True,
            message="Pushed successfully",
            path=remote_path,
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pull", response_model=OperationResult)
async def pull_to_local(
    device_id: str,
    remote_path: str = Query(..., description="Path on device to pull"),
    local_dir: str = Query(..., description="Local destination directory"),
    transfer_id: Optional[str] = Query(None, description="Transfer ID for cancellation"),
):
    """Pull a file from device directly to a local directory (no HTTP transfer)."""
    try:
        if not os.path.isdir(local_dir):
            raise HTTPException(status_code=404, detail=f"Local directory not found: {local_dir}")

        filename = os.path.basename(remote_path)
        local_dest = os.path.join(local_dir, filename)
        await adb.pull_file(device_id, remote_path, local_dest, transfer_id=transfer_id)
        return OperationResult(
            success=True,
            message=f"Pulled to {local_dest}",
            path=local_dest,
        )
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/cancel")
async def cancel_transfer(
    device_id: str,
    transfer_id: str = Query(..., description="Transfer ID to cancel"),
):
    """Cancel an in-progress transfer."""
    cancelled = adb.cancel_transfer(transfer_id)
    return {"cancelled": cancelled, "transfer_id": transfer_id}


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
