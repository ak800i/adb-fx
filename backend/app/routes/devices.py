"""
Device management routes.
"""
from fastapi import APIRouter, HTTPException
from typing import List
from ..adb import adb, ADBError
from ..models import Device, DeviceStorageInfo

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=List[Device])
async def list_devices():
    """Get list of connected Android devices."""
    try:
        devices = await adb.get_devices()
        return devices
    except ADBError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{device_id}/storage", response_model=List[DeviceStorageInfo])
async def get_device_storage(device_id: str):
    """Get storage information for a device."""
    try:
        storage = await adb.get_storage_info(device_id)
        return storage
    except ADBError as e:
        raise HTTPException(status_code=500, detail=str(e))
