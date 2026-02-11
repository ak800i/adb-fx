"""
Device management routes.
"""
from fastapi import APIRouter, HTTPException
from typing import List
from ..adb import adb, ADBError
from ..models import (
    Device, DeviceStorageInfo, OperationResult,
    WirelessConnectRequest, WirelessPairRequest, TcpIpRequest,
)

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


# --------------- Wireless ADB ---------------

@router.post("/wireless/connect", response_model=OperationResult)
async def wireless_connect(req: WirelessConnectRequest):
    """Connect to a device over Wi-Fi / TCP."""
    try:
        msg = await adb.connect_wireless(req.address, req.port)
        return OperationResult(success=True, message=msg)
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/wireless/disconnect", response_model=OperationResult)
async def wireless_disconnect(req: WirelessConnectRequest):
    """Disconnect a wireless device."""
    try:
        msg = await adb.disconnect_wireless(req.address, req.port)
        return OperationResult(success=True, message=msg)
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/wireless/pair", response_model=OperationResult)
async def wireless_pair(req: WirelessPairRequest):
    """Pair with a device using Android 11+ wireless debugging pairing code."""
    try:
        msg = await adb.pair_wireless(req.address, req.port, req.code)
        return OperationResult(success=True, message=msg)
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/wireless/tcpip", response_model=OperationResult)
async def wireless_tcpip(req: TcpIpRequest):
    """Switch a USB-connected device to TCP/IP mode for wireless connections."""
    try:
        msg = await adb.tcpip_mode(req.device_id, req.port)
        return OperationResult(success=True, message=msg)
    except ADBError as e:
        raise HTTPException(status_code=400, detail=str(e))
