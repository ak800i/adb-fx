"""
Pydantic models for the ADB File Explorer API.
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
from datetime import datetime


class FileType(str, Enum):
    FILE = "file"
    DIRECTORY = "directory"
    LINK = "link"
    UNKNOWN = "unknown"


class DeviceState(str, Enum):
    DEVICE = "device"
    OFFLINE = "offline"
    UNAUTHORIZED = "unauthorized"
    NO_PERMISSIONS = "no permissions"
    UNKNOWN = "unknown"


class Device(BaseModel):
    """Represents a connected Android device."""
    id: str = Field(..., description="Device serial number")
    model: Optional[str] = Field(None, description="Device model name")
    state: DeviceState = Field(..., description="Device connection state")
    product: Optional[str] = Field(None, description="Product name")
    transport_id: Optional[str] = Field(None, description="Transport ID")
    usb: Optional[str] = Field(None, description="USB bus path reported by 'adb devices -l' (e.g. 1-4)")


class FileEntry(BaseModel):
    """Represents a file or directory on the device."""
    name: str = Field(..., description="File or directory name")
    path: str = Field(..., description="Full path on device")
    type: FileType = Field(..., description="Type of entry")
    size: Optional[int] = Field(None, description="File size in bytes")
    permissions: Optional[str] = Field(None, description="Unix permissions string")
    owner: Optional[str] = Field(None, description="Owner user")
    group: Optional[str] = Field(None, description="Owner group")
    modified: Optional[datetime] = Field(None, description="Last modified time")
    link_target: Optional[str] = Field(None, description="Target path if symlink")


class FileListResponse(BaseModel):
    """Response for file listing."""
    path: str = Field(..., description="Current directory path")
    entries: List[FileEntry] = Field(default_factory=list, description="List of files and directories")
    parent: Optional[str] = Field(None, description="Parent directory path")
    total: int = Field(0, description="Total number of entries in the directory")
    offset: int = Field(0, description="Offset of the first returned entry")
    has_more: bool = Field(False, description="Whether more entries exist beyond this page")


class TransferProgress(BaseModel):
    """File transfer progress information."""
    filename: str
    bytes_transferred: int
    total_bytes: Optional[int]
    percent: Optional[float]
    speed: Optional[str]


class OperationResult(BaseModel):
    """Result of a file operation."""
    success: bool
    message: str
    path: Optional[str] = None


class CreateDirectoryRequest(BaseModel):
    """Request to create a directory."""
    path: str = Field(..., description="Full path of directory to create")


class DeleteRequest(BaseModel):
    """Request to delete a file or directory."""
    path: str = Field(..., description="Full path to delete")
    recursive: bool = Field(False, description="Recursively delete directories")


class BulkDeleteRequest(BaseModel):
    """Request to delete multiple files or directories."""
    paths: List[str] = Field(..., description="List of full paths to delete")


class BulkPullRequest(BaseModel):
    """Request to pull multiple files from device."""
    paths: List[str] = Field(..., description="List of remote paths to pull")
    local_dir: str = Field(..., description="Local destination directory")


class RenameRequest(BaseModel):
    """Request to rename a file or directory."""
    old_path: str = Field(..., description="Current path")
    new_path: str = Field(..., description="New path")


class DeviceStorageInfo(BaseModel):
    """Storage information for a device."""
    total: int = Field(..., description="Total storage in bytes")
    used: int = Field(..., description="Used storage in bytes")
    available: int = Field(..., description="Available storage in bytes")
    mount_point: str = Field(..., description="Mount point path")


class WirelessConnectRequest(BaseModel):
    """Request to connect to a device wirelessly."""
    address: str = Field(..., description="IP address of the device")
    port: int = Field(5555, description="TCP port (default 5555)")


class WirelessPairRequest(BaseModel):
    """Request to pair with a device using Android 11+ wireless debugging."""
    address: str = Field(..., description="IP address of the device")
    port: int = Field(..., description="Pairing port shown on device")
    code: str = Field(..., description="Pairing code shown on device")


class TcpIpRequest(BaseModel):
    """Request to switch a USB device to TCP/IP mode."""
    device_id: str = Field(..., description="Serial of the USB-connected device")
    port: int = Field(5555, description="TCP port to listen on")


class ConnectionInfo(BaseModel):
    """How a device is connected: transport, USB link, power and versions."""
    transport: str = Field(..., description="'usb' or 'wifi'")
    usb_path: Optional[str] = Field(None, description="USB bus path on the host, if reported")
    usb_speed: Optional[str] = Field(None, description="Raw negotiated link speed, e.g. 'super-speed-plus'")
    usb_speed_label: Optional[str] = Field(None, description="Human-readable link speed")
    usb_speed_bps: Optional[int] = Field(None, description="Nominal link speed in bits per second")
    usb_max_speed: Optional[str] = Field(None, description="Fastest speed the device's USB controller supports")
    usb_max_speed_label: Optional[str] = None
    usb_controller: Optional[str] = Field(None, description="Device-side USB controller (UDC) name")
    usb_functions: Optional[str] = Field(None, description="Active USB functions, e.g. 'mtp,adb'")
    usb_voltage_mv: Optional[int] = Field(None, description="VBUS voltage in millivolts, if readable")
    usb_current_ma: Optional[int] = Field(None, description="USB input current in milliamps, if readable")
    power_source: Optional[str] = Field(None, description="'USB', 'AC', 'Wireless' or 'Battery'")
    battery_level: Optional[int] = None
    battery_status: Optional[str] = None
    battery_temp_c: Optional[float] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    android_version: Optional[str] = None
    sdk: Optional[int] = None
    adb_version: Optional[str] = Field(None, description="Host ADB version")
