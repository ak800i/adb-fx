"""
ADB (Android Debug Bridge) wrapper module.
Provides a Python interface for common ADB operations.
"""
import asyncio
import subprocess
import re
import os
import logging
import shutil
import threading
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from datetime import datetime

logger = logging.getLogger("adb")
from .models import (
    Device, DeviceState, FileEntry, FileType, 
    FileListResponse, DeviceStorageInfo
)


class ADBError(Exception):
    """Exception raised for ADB errors."""
    def __init__(self, message: str, command: Optional[str] = None):
        self.message = message
        self.command = command
        super().__init__(self.message)


class ADBWrapper:
    """
    Wrapper class for ADB (Android Debug Bridge) operations.
    """
    
    def __init__(self, adb_path: Optional[str] = None):
        """
        Initialize the ADB wrapper.
        
        Args:
            adb_path: Path to ADB executable. If None, uses 'adb' from PATH.
        """
        self.adb_path = adb_path or self._find_adb()
        self._active_transfers: Dict[str, subprocess.Popen] = {}
        self._transfers_lock = threading.Lock()
    
    def _find_adb(self) -> str:
        """Find ADB executable in system PATH."""
        # Check for bundled ADB in repo's platform-tools directory first
        repo_root = Path(__file__).resolve().parent.parent.parent
        bundled_adb = repo_root / "platform-tools" / "adb.exe"
        if bundled_adb.exists():
            return str(bundled_adb)
        
        adb_exe = shutil.which("adb")
        if adb_exe:
            return adb_exe
        
        # Check common installation paths on Windows
        common_paths = [
            os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"),
            os.path.expandvars(r"%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe"),
            r"C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe",
            r"C:\Android\platform-tools\adb.exe",
        ]
        
        for path in common_paths:
            if os.path.exists(path):
                return path
        
        return "adb"  # Fallback to PATH
    
    async def _run_command(
        self, 
        *args: str, 
        device_id: Optional[str] = None,
        timeout: int = 30
    ) -> Tuple[str, str, int]:
        """
        Run an ADB command asynchronously.
        
        Args:
            *args: Command arguments
            device_id: Target device ID
            timeout: Command timeout in seconds
            
        Returns:
            Tuple of (stdout, stderr, return_code)
        """
        cmd = [self.adb_path]
        
        if device_id:
            cmd.extend(["-s", device_id])
        
        cmd.extend(args)
        
        # Suppress noisy device-polling commands
        quiet = args[:2] == ("devices", "-l")
        
        if not quiet:
            logger.debug("CMD: %s", " ".join(cmd))
        
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                cmd,
                capture_output=True,
                timeout=timeout,
            )
            
            stdout = result.stdout.decode("utf-8", errors="replace")
            stderr = result.stderr.decode("utf-8", errors="replace")
            
            if not quiet:
                logger.debug("EXIT: %d", result.returncode)
                if stdout.strip():
                    logger.debug("STDOUT: %s", stdout.strip())
                if stderr.strip():
                    logger.debug("STDERR: %s", stderr.strip())
            
            return (stdout, stderr, result.returncode)
        except subprocess.TimeoutExpired:
            logger.error("TIMEOUT: %s (after %ds)", " ".join(cmd), timeout)
            raise ADBError(f"Command timed out after {timeout}s", " ".join(cmd))
        except FileNotFoundError:
            raise ADBError(
                "ADB executable not found. Please install Android SDK Platform Tools.",
                " ".join(cmd)
            )
    
    async def _run_cancellable(
        self,
        *args: str,
        device_id: Optional[str] = None,
        transfer_id: Optional[str] = None,
        timeout: int = 300,
    ) -> Tuple[str, str, int]:
        """
        Run an ADB command that can be cancelled via transfer_id.
        Uses Popen so the process handle can be killed.
        """
        cmd = [self.adb_path]
        if device_id:
            cmd.extend(["-s", device_id])
        cmd.extend(args)

        logger.debug("CMD: %s", " ".join(cmd))

        def _run() -> Tuple[str, str, int]:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            if transfer_id:
                with self._transfers_lock:
                    self._active_transfers[transfer_id] = proc
            try:
                stdout_bytes, stderr_bytes = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                raise
            finally:
                if transfer_id:
                    with self._transfers_lock:
                        self._active_transfers.pop(transfer_id, None)
            return (
                stdout_bytes.decode("utf-8", errors="replace"),
                stderr_bytes.decode("utf-8", errors="replace"),
                proc.returncode,
            )

        try:
            stdout, stderr, code = await asyncio.to_thread(_run)
            logger.debug("EXIT: %d", code)
            if stdout.strip():
                logger.debug("STDOUT: %s", stdout.strip())
            if stderr.strip():
                logger.debug("STDERR: %s", stderr.strip())
            return (stdout, stderr, code)
        except subprocess.TimeoutExpired:
            logger.error("TIMEOUT: %s (after %ds)", " ".join(cmd), timeout)
            raise ADBError(f"Command timed out after {timeout}s", " ".join(cmd))
        except FileNotFoundError:
            raise ADBError(
                "ADB executable not found. Please install Android SDK Platform Tools.",
                " ".join(cmd)
            )

    def cancel_transfer(self, transfer_id: str) -> bool:
        """Cancel a running transfer by killing its subprocess."""
        with self._transfers_lock:
            proc = self._active_transfers.pop(transfer_id, None)
        if proc:
            try:
                proc.kill()
                logger.info("Cancelled transfer: %s", transfer_id)
                return True
            except OSError:
                pass
        return False
    def _run_command_sync(
        self, 
        *args: str, 
        device_id: Optional[str] = None,
        timeout: int = 30
    ) -> Tuple[str, str, int]:
        """Run an ADB command synchronously."""
        cmd = [self.adb_path]
        
        if device_id:
            cmd.extend(["-s", device_id])
        
        cmd.extend(args)
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout,
                text=True
            )
            return result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired:
            raise ADBError(f"Command timed out after {timeout}s", " ".join(cmd))
        except FileNotFoundError:
            raise ADBError(
                "ADB executable not found. Please install Android SDK Platform Tools.",
                " ".join(cmd)
            )
    
    async def get_devices(self) -> List[Device]:
        """
        Get list of connected Android devices.
        
        Returns:
            List of Device objects
        """
        stdout, stderr, code = await self._run_command("devices", "-l")
        
        if code != 0:
            raise ADBError(f"Failed to list devices: {stderr}")
        
        devices = []
        lines = stdout.strip().split("\n")[1:]  # Skip header line
        
        for line in lines:
            if not line.strip():
                continue
            
            parts = line.split()
            if len(parts) < 2:
                continue
            
            device_id = parts[0]
            state_str = parts[1]
            
            # Parse state
            state_map = {
                "device": DeviceState.DEVICE,
                "offline": DeviceState.OFFLINE,
                "unauthorized": DeviceState.UNAUTHORIZED,
                "no": DeviceState.NO_PERMISSIONS,
            }
            state = state_map.get(state_str, DeviceState.UNKNOWN)
            
            # Parse additional properties
            props = {}
            for part in parts[2:]:
                if ":" in part:
                    key, value = part.split(":", 1)
                    props[key] = value
            
            devices.append(Device(
                id=device_id,
                state=state,
                model=props.get("model"),
                product=props.get("product"),
                transport_id=props.get("transport_id")
            ))
        
        return devices
    
    async def list_files(
        self, 
        device_id: str, 
        path: str = "/sdcard"
    ) -> FileListResponse:
        """
        List files and directories at the given path.
        
        Args:
            device_id: Target device ID
            path: Directory path on device
            
        Returns:
            FileListResponse with list of entries
        """
        # Normalize path
        path = path.rstrip("/") or "/"
        
        # Use ls -la for detailed listing
        stdout, stderr, code = await self._run_command(
            "shell", f"ls -la '{path}'",
            device_id=device_id,
            timeout=10
        )
        
        if code != 0 or "No such file or directory" in stderr or "No such file or directory" in stdout:
            raise ADBError(f"Directory not found: {path}")
        
        if "Permission denied" in stdout or "Permission denied" in stderr:
            raise ADBError(f"Permission denied: {path}")
        
        entries = []
        lines = stdout.strip().split("\n")
        
        for line in lines:
            entry = self._parse_ls_line(line, path)
            if entry and entry.name not in (".", ".."):
                entries.append(entry)
        
        # Sort: directories first, then files, alphabetically
        entries.sort(key=lambda e: (e.type != FileType.DIRECTORY, e.name.lower()))
        
        # Determine parent directory
        parent = None
        if path != "/":
            parent = str(Path(path).parent).replace("\\", "/")
        
        return FileListResponse(
            path=path,
            entries=entries,
            parent=parent
        )
    
    def _parse_ls_line(self, line: str, base_path: str) -> Optional[FileEntry]:
        """Parse a single line from ls -la output."""
        # Skip empty lines and total line
        line = line.strip()
        if not line or line.startswith("total"):
            return None
        
        # Pattern for ls -la output
        # Example: drwxrwx--x  4 root sdcard_rw 4096 2024-01-15 10:30 Download
        # Or: -rw-rw----  1 root sdcard_rw 12345 2024-01-15 10:30 file.txt
        # Or: lrwxrwxrwx  1 root root 21 2024-01-15 10:30 link -> target
        
        pattern = r'^([dlcbsp-])([rwxsStT-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$'
        match = re.match(pattern, line)
        
        if not match:
            # Try simpler pattern (some devices have different output)
            parts = line.split()
            if len(parts) >= 8:
                perms = parts[0]
                name = " ".join(parts[7:])
                
                file_type = FileType.UNKNOWN
                if perms.startswith("d"):
                    file_type = FileType.DIRECTORY
                elif perms.startswith("l"):
                    file_type = FileType.LINK
                elif perms.startswith("-"):
                    file_type = FileType.FILE
                
                # Handle symlinks
                link_target = None
                if " -> " in name:
                    name, link_target = name.split(" -> ", 1)
                
                full_path = f"{base_path}/{name}".replace("//", "/")
                
                return FileEntry(
                    name=name,
                    path=full_path,
                    type=file_type,
                    permissions=perms,
                    link_target=link_target
                )
            return None
        
        type_char = match.group(1)
        perms = match.group(1) + match.group(2)
        owner = match.group(4)
        group = match.group(5)
        size = int(match.group(6))
        date_str = match.group(7)
        time_str = match.group(8)
        name = match.group(9)
        
        # Determine file type
        type_map = {
            'd': FileType.DIRECTORY,
            'l': FileType.LINK,
            '-': FileType.FILE,
            'c': FileType.FILE,  # Character device
            'b': FileType.FILE,  # Block device
            's': FileType.FILE,  # Socket
            'p': FileType.FILE,  # Pipe
        }
        file_type = type_map.get(type_char, FileType.UNKNOWN)
        
        # Handle symlinks
        link_target = None
        if " -> " in name:
            name, link_target = name.split(" -> ", 1)
        
        # Parse datetime
        try:
            modified = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        except ValueError:
            modified = None
        
        full_path = f"{base_path}/{name}".replace("//", "/")
        
        return FileEntry(
            name=name,
            path=full_path,
            type=file_type,
            size=size if file_type == FileType.FILE else None,
            permissions=perms,
            owner=owner,
            group=group,
            modified=modified,
            link_target=link_target
        )
    
    async def pull_file(
        self, 
        device_id: str, 
        remote_path: str, 
        local_path: str,
        transfer_id: Optional[str] = None,
    ) -> bool:
        """
        Download a file from the device.
        
        Args:
            device_id: Target device ID
            remote_path: Path on device
            local_path: Local destination path
            transfer_id: Optional ID for cancellation
            
        Returns:
            True if successful
        """
        # Ensure local directory exists
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        stdout, stderr, code = await self._run_cancellable(
            "pull", remote_path, local_path,
            device_id=device_id,
            transfer_id=transfer_id,
            timeout=300,
        )
        
        if code != 0:
            # Check if killed by cancel
            if code < 0 or 'killed' in (stderr or '').lower():
                raise ADBError("Transfer cancelled")
            raise ADBError(f"Failed to pull file: {stderr or stdout}")
        
        return True
    
    async def push_file(
        self, 
        device_id: str, 
        local_path: str, 
        remote_path: str,
        transfer_id: Optional[str] = None,
    ) -> bool:
        """
        Upload a file to the device.
        
        Args:
            device_id: Target device ID
            local_path: Local file path
            remote_path: Destination path on device
            transfer_id: Optional ID for cancellation
            
        Returns:
            True if successful
        """
        if not os.path.exists(local_path):
            raise ADBError(f"Local file not found: {local_path}")
        
        stdout, stderr, code = await self._run_cancellable(
            "push", local_path, remote_path,
            device_id=device_id,
            transfer_id=transfer_id,
            timeout=300,
        )
        
        if code != 0:
            if code < 0 or 'killed' in (stderr or '').lower():
                raise ADBError("Transfer cancelled")
            raise ADBError(f"Failed to push file: {stderr or stdout}")
        
        return True
    
    async def delete(
        self, 
        device_id: str, 
        path: str, 
        recursive: bool = False
    ) -> bool:
        """
        Delete a file or directory on the device.
        
        Args:
            device_id: Target device ID
            path: Path to delete
            recursive: If True, delete directories recursively
            
        Returns:
            True if successful
        """
        if recursive:
            cmd = f"rm -rf '{path}'"
        else:
            cmd = f"rm -f '{path}'"
        
        stdout, stderr, code = await self._run_command(
            "shell", cmd,
            device_id=device_id
        )
        
        if code != 0 or "Permission denied" in stderr:
            raise ADBError(f"Failed to delete: {stderr or stdout}")
        
        return True
    
    async def mkdir(self, device_id: str, path: str) -> bool:
        """
        Create a directory on the device.
        
        Args:
            device_id: Target device ID
            path: Directory path to create
            
        Returns:
            True if successful
        """
        stdout, stderr, code = await self._run_command(
            "shell", f"mkdir -p '{path}'",
            device_id=device_id
        )
        
        if code != 0 or "Permission denied" in stderr:
            raise ADBError(f"Failed to create directory: {stderr or stdout}")
        
        return True
    
    async def rename(
        self, 
        device_id: str, 
        old_path: str, 
        new_path: str
    ) -> bool:
        """
        Rename/move a file or directory on the device.
        
        Args:
            device_id: Target device ID
            old_path: Current path
            new_path: New path
            
        Returns:
            True if successful
        """
        stdout, stderr, code = await self._run_command(
            "shell", f"mv '{old_path}' '{new_path}'",
            device_id=device_id
        )
        
        if code != 0:
            raise ADBError(f"Failed to rename: {stderr or stdout}")
        
        return True
    
    async def get_storage_info(self, device_id: str) -> List[DeviceStorageInfo]:
        """
        Get storage information for the device.
        
        Args:
            device_id: Target device ID
            
        Returns:
            List of storage info for each mount point
        """
        stdout, stderr, code = await self._run_command(
            "shell", "df -h",
            device_id=device_id
        )
        
        if code != 0:
            raise ADBError(f"Failed to get storage info: {stderr}")
        
        storage_list = []
        lines = stdout.strip().split("\n")[1:]  # Skip header
        
        for line in lines:
            parts = line.split()
            if len(parts) >= 6 and parts[5].startswith("/"):
                mount_point = parts[5]
                
                # Only include relevant mount points
                if any(mp in mount_point for mp in ["/sdcard", "/storage", "/data"]):
                    try:
                        # Parse size values (convert from human-readable)
                        total = self._parse_size(parts[1])
                        used = self._parse_size(parts[2])
                        available = self._parse_size(parts[3])
                        
                        storage_list.append(DeviceStorageInfo(
                            total=total,
                            used=used,
                            available=available,
                            mount_point=mount_point
                        ))
                    except (ValueError, IndexError):
                        continue
        
        return storage_list
    
    def _parse_size(self, size_str: str) -> int:
        """Parse human-readable size string to bytes."""
        size_str = size_str.upper().strip()
        
        multipliers = {
            'B': 1,
            'K': 1024,
            'M': 1024 ** 2,
            'G': 1024 ** 3,
            'T': 1024 ** 4,
        }
        
        for suffix, mult in multipliers.items():
            if size_str.endswith(suffix):
                return int(float(size_str[:-1]) * mult)
        
        return int(float(size_str))
    
    async def file_exists(self, device_id: str, path: str) -> bool:
        """Check if a file or directory exists on the device."""
        stdout, stderr, code = await self._run_command(
            "shell", f"test -e '{path}' && echo 'exists'",
            device_id=device_id
        )
        return "exists" in stdout
    
    async def is_directory(self, device_id: str, path: str) -> bool:
        """Check if path is a directory on the device."""
        stdout, stderr, code = await self._run_command(
            "shell", f"test -d '{path}' && echo 'yes'",
            device_id=device_id
        )
        return "yes" in stdout


# Global ADB instance
adb = ADBWrapper()
