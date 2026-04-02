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
import time
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
        self._transfer_progress: Dict[str, dict] = {}  # {progress, bytes_transferred, speed_bps, total_size}
        self._transfers_lock = threading.Lock()
    
    @staticmethod
    def _shell_escape(path: str) -> str:
        """Escape a path for safe use inside a single-quoted shell argument.

        This handles characters like ' ( ) by ending the current
        single-quoted segment, inserting an escaped character, and
        re-opening single quotes.  e.g.  it's -> 'it'\''s'
        """
        return path.replace("'", "'\\''")

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
    ) -> Tuple[str, str, int]:
        """
        Run an ADB command that can be cancelled via transfer_id.
        Uses Popen so the process handle can be killed on cancel.
        Note: ADB does NOT output progress to piped stderr (only to TTY),
        so progress is tracked separately via file-size monitoring.
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
                stdout_bytes, stderr_bytes = proc.communicate()
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

    def _get_remote_file_size_sync(self, device_id: str, remote_path: str) -> Optional[int]:
        """Get file size on device via sync subprocess. Returns None on failure."""
        escaped = self._shell_escape(remote_path)
        shell_cmd = f"stat -c %s '{escaped}'"
        try:
            result = subprocess.run(
                [self.adb_path, "-s", device_id, "shell", shell_cmd],
                capture_output=True, timeout=5,
            )
            if result.returncode == 0:
                size_str = result.stdout.decode().strip()
                if size_str.isdigit():
                    return int(size_str)
                logger.debug("STAT unexpected output: %r", size_str)
            else:
                logger.debug("STAT failed (rc=%d): %s", result.returncode, result.stderr.decode().strip())
        except Exception as e:
            logger.debug("STAT exception: %s", e)
        return None

    def _get_remote_dir_size_sync(self, device_id: str, remote_path: str) -> Optional[int]:
        """Get total size of a directory tree on device via 'du -sb'. Returns None on failure."""
        escaped = self._shell_escape(remote_path)
        shell_cmd = f"du -sb '{escaped}'"
        try:
            result = subprocess.run(
                [self.adb_path, "-s", device_id, "shell", shell_cmd],
                capture_output=True, timeout=10,
            )
            if result.returncode == 0:
                # du -sb outputs: <size>\t<path>
                size_str = result.stdout.decode().strip().split()[0]
                if size_str.isdigit():
                    return int(size_str)
        except Exception as e:
            logger.debug("DU exception: %s", e)
        return None

    @staticmethod
    def _get_local_total_size(path: str) -> int:
        """Get total size of a file or directory tree in bytes."""
        if os.path.isfile(path):
            return os.path.getsize(path)
        total = 0
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
        return total

    def _start_progress_monitor(
        self,
        transfer_id: str,
        total_size: int,
        size_fn,
        interval: float = 0.5,
    ) -> None:
        """
        Start a daemon thread that polls size_fn() and updates _transfer_progress.
        Runs until transfer_id is removed from _transfer_progress.
        """
        if total_size <= 0:
            return

        def _monitor():
            last_logged_pct = -10
            prev_bytes = 0
            prev_time = time.monotonic()
            # Exponential moving average factor for smoothing speed
            ema_speed = 0.0
            alpha = 0.3
            logger.info("MONITOR started [%s]: total_size=%d, interval=%.1fs", transfer_id, total_size, interval)
            while transfer_id in self._transfer_progress:
                try:
                    current = size_fn()
                    if current is not None:
                        now = time.monotonic()
                        dt = now - prev_time
                        pct = min(int(current / total_size * 100), 99)
                        # Calculate instantaneous speed
                        if dt > 0:
                            instant_speed = (current - prev_bytes) / dt
                            ema_speed = alpha * instant_speed + (1 - alpha) * ema_speed
                        prev_bytes = current
                        prev_time = now
                        self._transfer_progress[transfer_id] = {
                            "progress": pct,
                            "bytes_transferred": current,
                            "speed_bps": max(0, int(ema_speed)),
                            "total_size": total_size,
                        }
                        if pct - last_logged_pct >= 10:
                            last_logged_pct = pct
                            logger.info("PROGRESS [%s]: %d%% (%d / %d bytes, %.1f KB/s)", transfer_id, pct, current, total_size, ema_speed / 1024)
                    else:
                        logger.debug("MONITOR [%s]: size_fn returned None", transfer_id)
                except Exception as e:
                    logger.debug("MONITOR [%s] error: %s", transfer_id, e)
                time.sleep(interval)
            logger.info("MONITOR stopped [%s]", transfer_id)

        t = threading.Thread(target=_monitor, daemon=True)
        t.start()

    def get_progress(self, transfer_id: str) -> Optional[dict]:
        """Get the current progress info for a transfer, or None."""
        return self._transfer_progress.get(transfer_id)

    def cancel_transfer(self, transfer_id: str) -> bool:
        """Cancel a running transfer by killing its subprocess."""
        with self._transfers_lock:
            proc = self._active_transfers.pop(transfer_id, None)
        self._transfer_progress.pop(transfer_id, None)
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
        path: str = "/storage",
        offset: int = 0,
        limit: int = 1000,
    ) -> FileListResponse:
        """
        List files and directories at the given path.
        
        Args:
            device_id: Target device ID
            path: Directory path on device
            offset: Pagination offset (0-based)
            limit: Maximum number of entries to return
            
        Returns:
            FileListResponse with list of entries
        """
        # Normalize path
        path = path.rstrip("/") or "/"
        
        # Use ls -la for detailed listing
        escaped = self._shell_escape(path)
        stdout, stderr, code = await self._run_command(
            "shell", f"ls -la '{escaped}'",
            device_id=device_id,
            timeout=60
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
        
        total = len(entries)
        page = entries[offset:offset + limit]
        
        # Determine parent directory
        parent = None
        if path != "/":
            parent = str(Path(path).parent).replace("\\", "/")
        
        return FileListResponse(
            path=path,
            entries=page,
            parent=parent,
            total=total,
            offset=offset,
            has_more=(offset + limit) < total,
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

        # Start file-size progress monitor for pulls
        if transfer_id:
            self._transfer_progress[transfer_id] = {"progress": 0, "bytes_transferred": 0, "speed_bps": 0, "total_size": 0}
            # Determine remote size and whether it's a directory.
            # stat -c %s returns inode size for dirs (e.g. 4096), file size for files.
            # du -sb returns recursive total for dirs, same as stat for files.
            # Compare them to detect directories reliably.
            stat_size = self._get_remote_file_size_sync(device_id, remote_path)
            du_size = self._get_remote_dir_size_sync(device_id, remote_path)
            is_remote_dir = False
            if du_size is not None and stat_size is not None and du_size > stat_size:
                remote_size = du_size
                is_remote_dir = True
            elif du_size is not None and stat_size is None:
                remote_size = du_size
                is_remote_dir = True
            else:
                remote_size = stat_size or du_size
            logger.debug("PULL [%s]: stat=%s, du=%s, is_dir=%s, dest=%s", transfer_id, stat_size, du_size, is_remote_dir, local_path)
            if remote_size and remote_size > 0:
                if is_remote_dir:
                    size_fn = lambda: self._get_local_total_size(local_path)
                else:
                    # Use open+seek instead of os.path.getsize — on Windows,
                    # os.stat may return cached/stale size while adb is writing.
                    def size_fn():
                        try:
                            with open(local_path, 'rb') as f:
                                f.seek(0, 2)
                                return f.tell()
                        except OSError:
                            return 0
                self._start_progress_monitor(transfer_id, remote_size, size_fn)

        try:
            stdout, stderr, code = await self._run_cancellable(
                "pull", remote_path, local_path,
                device_id=device_id,
                transfer_id=transfer_id,
            )
        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)

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

        # Start file-size progress monitor for pushes
        if transfer_id:
            self._transfer_progress[transfer_id] = {"progress": 0, "bytes_transferred": 0, "speed_bps": 0, "total_size": 0}
            local_size = self._get_local_total_size(local_path)
            is_dir = os.path.isdir(local_path)
            logger.debug("PUSH [%s]: local_size=%s, is_dir=%s, dest=%s", transfer_id, local_size, is_dir, remote_path)
            if local_size > 0:
                if is_dir:
                    # adb push creates remote_path/basename(local_path)/
                    # Monitor that specific subfolder, NOT the whole parent dir
                    monitor_path = f"{remote_path.rstrip('/')}/{os.path.basename(local_path)}"
                    logger.debug("PUSH [%s]: monitoring remote subfolder %s", transfer_id, monitor_path)
                    size_fn = lambda _mp=monitor_path: self._get_remote_dir_size_sync(device_id, _mp)
                else:
                    # For single files: monitor destination file size via stat
                    size_fn = lambda: self._get_remote_file_size_sync(device_id, remote_path)
                self._start_progress_monitor(transfer_id, local_size, size_fn, interval=1.0)

        try:
            stdout, stderr, code = await self._run_cancellable(
                "push", local_path, remote_path,
                device_id=device_id,
                transfer_id=transfer_id,
            )
        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)

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
        escaped = self._shell_escape(path)
        if recursive:
            cmd = f"rm -rf '{escaped}'"
        else:
            cmd = f"rm -f '{escaped}'"
        
        stdout, stderr, code = await self._run_command(
            "shell", cmd,
            device_id=device_id
        )
        
        if code != 0 or "Permission denied" in stderr:
            raise ADBError(f"Failed to delete: {stderr or stdout}")
        
        return True
    
    async def bulk_delete(
        self,
        device_id: str,
        paths: list[str],
    ) -> bool:
        """
        Delete multiple files/directories in batched shell commands.

        Paths are grouped into batches to stay within safe command-line
        length limits.
        """
        MAX_CMD_LEN = 4096  # conservative limit for adb shell
        batch: list[str] = []
        current_len = len("rm -rf")

        async def flush(batch: list[str]) -> None:
            if not batch:
                return
            args = " ".join(f"'{self._shell_escape(p)}'" for p in batch)
            cmd = f"rm -rf {args}"
            stdout, stderr, code = await self._run_command(
                "shell", cmd, device_id=device_id
            )
            if code != 0 or "Permission denied" in stderr:
                raise ADBError(f"Bulk delete failed: {stderr or stdout}")

        for path in paths:
            escaped = f"'{self._shell_escape(path)}'"
            entry_len = len(escaped) + 1  # +1 for space
            if current_len + entry_len > MAX_CMD_LEN and batch:
                await flush(batch)
                batch = []
                current_len = len("rm -rf")
            batch.append(path)
            current_len += entry_len

        await flush(batch)
        return True

    async def bulk_pull(
        self,
        device_id: str,
        remote_paths: list[str],
        local_dir: str,
        transfer_id: Optional[str] = None,
    ) -> tuple[int, int]:
        """
        Pull multiple files from device with count-based progress.

        Returns (completed_count, failed_count).
        """
        os.makedirs(local_dir, exist_ok=True)
        total = len(remote_paths)
        completed = 0
        failed = 0

        if transfer_id:
            self._transfer_progress[transfer_id] = {
                "progress": 0, "bytes_transferred": 0,
                "speed_bps": 0, "total_size": total,
            }

        try:
            for remote_path in remote_paths:
                # Check for cancellation
                if transfer_id:
                    with self._transfers_lock:
                        if transfer_id not in self._active_transfers and completed > 0:
                            # Was cancelled
                            raise ADBError("Transfer cancelled")

                filename = os.path.basename(remote_path)
                local_dest = os.path.join(local_dir, filename)
                try:
                    stdout, stderr, code = await self._run_cancellable(
                        "pull", remote_path, local_dest,
                        device_id=device_id,
                        transfer_id=transfer_id,
                    )
                    if code != 0:
                        if code < 0 or "killed" in (stderr or "").lower():
                            raise ADBError("Transfer cancelled")
                        logger.warning("Failed to pull %s: %s", remote_path, stderr)
                        failed += 1
                    else:
                        completed += 1
                except ADBError:
                    raise
                except Exception:
                    failed += 1

                if transfer_id:
                    pct = ((completed + failed) / total) * 100
                    self._transfer_progress[transfer_id] = {
                        "progress": pct,
                        "bytes_transferred": completed + failed,
                        "speed_bps": 0,
                        "total_size": total,
                    }
        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)

        return completed, failed

    async def mkdir(self, device_id: str, path: str) -> bool:
        """
        Create a directory on the device.
        
        Args:
            device_id: Target device ID
            path: Directory path to create
            
        Returns:
            True if successful
        """
        escaped = self._shell_escape(path)
        stdout, stderr, code = await self._run_command(
            "shell", f"mkdir -p '{escaped}'",
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
        escaped_old = self._shell_escape(old_path)
        escaped_new = self._shell_escape(new_path)
        stdout, stderr, code = await self._run_command(
            "shell", f"mv '{escaped_old}' '{escaped_new}'",
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
        escaped = self._shell_escape(path)
        stdout, stderr, code = await self._run_command(
            "shell", f"test -e '{escaped}' && echo 'exists'",
            device_id=device_id
        )
        return "exists" in stdout
    
    async def is_directory(self, device_id: str, path: str) -> bool:
        """Check if path is a directory on the device."""
        escaped = self._shell_escape(path)
        stdout, stderr, code = await self._run_command(
            "shell", f"test -d '{escaped}' && echo 'yes'",
            device_id=device_id
        )
        return "yes" in stdout

    async def connect_wireless(self, address: str, port: int = 5555) -> str:
        """
        Connect to a device over Wi-Fi / TCP.

        Args:
            address: IP address (or host) of the device.
            port: TCP port (default 5555).

        Returns:
            Status message from adb.
        """
        target = f"{address}:{port}"
        stdout, stderr, code = await self._run_command("connect", target, timeout=15)
        output = (stdout + stderr).strip()
        # ADB returns 0 even on failure; inspect the text
        if "connected" in output.lower():
            return output
        raise ADBError(output or "Failed to connect")

    async def disconnect_wireless(self, address: str, port: int = 5555) -> str:
        """
        Disconnect a wireless device.

        Args:
            address: IP address (or host) of the device, or a full device
                     identifier (e.g. mDNS name) to pass directly to
                     ``adb disconnect``.
            port: TCP port (default 5555). Only used when *address* looks
                  like an IP address.

        Returns:
            Status message from adb.
        """
        import re
        # Only append port for plain IP addresses
        if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', address):
            target = f"{address}:{port}"
        else:
            target = address
        stdout, stderr, code = await self._run_command("disconnect", target, timeout=10)
        return (stdout + stderr).strip()

    async def pair_wireless(self, address: str, port: int, code_str: str) -> str:
        """
        Pair with a device using the Android 11+ wireless debugging pairing code.

        Args:
            address: IP address of the device.
            port: Pairing port shown on device.
            code_str: Pairing code shown on device.

        Returns:
            Status message from adb.
        """
        target = f"{address}:{port}"
        # adb pair <host:port> <code>
        stdout, stderr, code = await self._run_command("pair", target, code_str, timeout=15)
        output = (stdout + stderr).strip()
        if "successfully" in output.lower() or "paired" in output.lower():
            return output
        raise ADBError(output or "Pairing failed")

    async def tcpip_mode(self, device_id: str, port: int = 5555) -> str:
        """
        Switch a USB-connected device to TCP/IP mode so it can accept
        wireless connections.

        Args:
            device_id: Serial of the USB-connected device.
            port: TCP port to listen on (default 5555).

        Returns:
            Status message from adb.
        """
        stdout, stderr, code = await self._run_command(
            "tcpip", str(port), device_id=device_id, timeout=10
        )
        output = (stdout + stderr).strip()
        if code != 0 and output:
            raise ADBError(output)
        return output or f"Device listening on port {port}"


# Global ADB instance
adb = ADBWrapper()
