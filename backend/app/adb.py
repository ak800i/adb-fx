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
    FileListResponse, DeviceStorageInfo, ConnectionInfo
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
        self._cancelled_transfers: set = set()
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

    @staticmethod
    def _decode_ls_b(name: str) -> str:
        """Decode escape sequences produced by ls -b.

        ls -b escapes spaces as ``\\ `` (backslash-space), backslashes
        as ``\\\\``, and non-printable bytes as ``\\NNN`` (3-digit octal).
        We convert each escape back to the original byte, then decode
        the result as UTF-8 (with replace for truly broken sequences).
        """
        # Fast path: no escapes
        if "\\" not in name:
            return name

        _SIMPLE = {
            ord(" "): b" ",
            ord("\\"): b"\\",
            ord("n"): b"\n",
            ord("t"): b"\t",
            ord("r"): b"\r",
        }

        _OCTAL = set(b'01234567')

        result = bytearray()
        i = 0
        encoded = name.encode("utf-8")  # preserve raw byte values
        while i < len(encoded):
            if encoded[i:i+1] == b"\\" and i + 1 < len(encoded):
                nxt = encoded[i + 1]
                # Try 3-digit octal first (all 3 must be octal digits 0-7)
                if i + 3 < len(encoded):
                    octal = encoded[i+1:i+4]
                    if all(b in _OCTAL for b in octal):
                        result.append(int(octal, 8))
                        i += 4
                        continue
                # Simple single-char escapes (\ , \\, \n, \t, \r)
                if nxt in _SIMPLE:
                    result.extend(_SIMPLE[nxt])
                    i += 2
                    continue
            result.append(encoded[i])
            i += 1
        return result.decode("utf-8", errors="replace")

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

    @staticmethod
    def _scan_local_tree(path: str) -> Tuple[int, Optional[str]]:
        """Walk a local directory being written by `adb pull`.

        Returns (total_bytes, current_file). The current file is the one
        with the newest modification time — adb writes files one at a
        time, so the newest one is the file in flight. It is returned
        relative to the parent of `path`, e.g. "Camera/IMG_0001.jpg".
        """
        total = 0
        newest_mtime = -1.0
        newest_path: Optional[str] = None
        for dirpath, _dirnames, filenames in os.walk(path):
            for f in filenames:
                full = os.path.join(dirpath, f)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                total += st.st_size
                if st.st_mtime >= newest_mtime:
                    newest_mtime = st.st_mtime
                    newest_path = full
        rel = None
        if newest_path:
            base = os.path.dirname(os.path.normpath(path))
            rel = os.path.relpath(newest_path, base).replace("\\", "/")
        return total, rel

    def _get_remote_dir_progress_sync(
        self, device_id: str, remote_path: str
    ) -> Tuple[Optional[int], Optional[str]]:
        """Bytes written so far + the file in flight for a folder `adb push`.

        One `adb shell` round trip runs both:
          - `du -sb` for the bytes written so far
          - `find -mmin -1` for files touched in the last minute; the one
            with the newest mtime is the file adb is writing right now
            (finished files get the source file's older mtime restored).
        """
        escaped = self._shell_escape(remote_path)
        shell_cmd = (
            f"du -sb '{escaped}' 2>/dev/null | cut -f1; "
            f"find '{escaped}' -type f -mmin -1 -exec stat -c '%Y %n' {{}} + 2>/dev/null "
            f"| sort -n | tail -n 1"
        )
        try:
            result = subprocess.run(
                [self.adb_path, "-s", device_id, "shell", shell_cmd],
                capture_output=True, timeout=10,
            )
        except Exception as e:
            logger.debug("DIR PROGRESS exception: %s", e)
            return None, None
        lines = result.stdout.decode("utf-8", errors="replace").strip().splitlines()
        size: Optional[int] = None
        current: Optional[str] = None
        if lines and lines[0].strip().isdigit():
            size = int(lines[0].strip())
        if len(lines) > 1:
            parts = lines[-1].strip().split(" ", 1)
            if len(parts) == 2:
                full = parts[1]
                parent = remote_path.rstrip("/").rsplit("/", 1)[0]
                current = full[len(parent) + 1:] if full.startswith(parent + "/") else full
        return size, current

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

        size_fn may return either a byte count, or a tuple of
        (byte_count, current_file) where current_file is the file being
        copied right now (or None if unknown).
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
                    result = size_fn()
                    current_file = None
                    if isinstance(result, tuple):
                        current, current_file = result
                    else:
                        current = result
                    if current_file is None:
                        prev_info = self._transfer_progress.get(transfer_id) or {}
                        current_file = prev_info.get("current_file")
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
                        if transfer_id not in self._transfer_progress:
                            # Transfer finished while we were polling — don't
                            # re-create its entry (that would keep this thread alive).
                            break
                        self._transfer_progress[transfer_id] = {
                            "progress": pct,
                            "bytes_transferred": current,
                            "speed_bps": max(0, int(ema_speed)),
                            "total_size": total_size,
                            "current_file": current_file,
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
        flagged = False
        with self._transfers_lock:
            proc = self._active_transfers.pop(transfer_id, None)
            # Only mark as cancelled if there's an active bulk operation
            # that will check and clean up the flag. Without this guard,
            # stale IDs or single-file transfers would leak entries.
            if proc or transfer_id in self._transfer_progress:
                self._cancelled_transfers.add(transfer_id)
                flagged = True
        self._transfer_progress.pop(transfer_id, None)
        if proc:
            try:
                proc.kill()
                logger.info("Cancelled transfer: %s", transfer_id)
            except OSError:
                pass
        return flagged
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
                transport_id=props.get("transport_id"),
                usb=props.get("usb"),
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
        
        # Use ls -lab for detailed listing (-b escapes non-printable chars)
        escaped = self._shell_escape(path)
        stdout, stderr, code = await self._run_command(
            "shell", f"ls -lab '{escaped}'",
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
                    link_target = self._decode_ls_b(link_target)
                
                name = self._decode_ls_b(name)
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
            link_target = self._decode_ls_b(link_target)
        
        name = self._decode_ls_b(name)

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
            self._transfer_progress[transfer_id] = {
                "progress": 0, "bytes_transferred": 0, "speed_bps": 0, "total_size": 0,
                "current_file": os.path.basename(remote_path.rstrip("/")) or remote_path,
            }
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
                    # Total bytes so far + the most recently written file,
                    # which is the one adb is copying right now.
                    size_fn = lambda: self._scan_local_tree(local_path)
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
            self._transfer_progress[transfer_id] = {
                "progress": 0, "bytes_transferred": 0, "speed_bps": 0, "total_size": 0,
                "current_file": os.path.basename(os.path.normpath(local_path)),
            }
            local_size = self._get_local_total_size(local_path)
            is_dir = os.path.isdir(local_path)
            logger.debug("PUSH [%s]: local_size=%s, is_dir=%s, dest=%s", transfer_id, local_size, is_dir, remote_path)
            if local_size > 0:
                if is_dir:
                    # adb push creates remote_path/basename(local_path)/
                    # Monitor that specific subfolder, NOT the whole parent dir
                    monitor_path = f"{remote_path.rstrip('/')}/{os.path.basename(local_path)}"
                    logger.debug("PUSH [%s]: monitoring remote subfolder %s", transfer_id, monitor_path)
                    size_fn = lambda _mp=monitor_path: self._get_remote_dir_progress_sync(device_id, _mp)
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
        
        # Verify item was actually deleted (rm -f silently succeeds for
        # non-existent paths, which can hide encoding mismatches)
        check_stdout, _, _ = await self._run_command(
            "shell", f"[ -e '{escaped}' ] && echo EXISTS",
            device_id=device_id
        )
        if "EXISTS" in check_stdout:
            raise ADBError(f"Failed to delete (file still exists): {path}")
        
        return True
    
    async def bulk_delete(
        self,
        device_id: str,
        paths: list[str],
        transfer_id: Optional[str] = None,
    ) -> bool:
        """
        Delete multiple files/directories in batched shell commands.

        Paths are grouped into batches to stay within safe command-line
        length limits.  Progress (0-100) is tracked via transfer_id.
        """
        MAX_CMD_LEN = 4096  # conservative limit for adb shell
        total = len(paths)
        deleted = 0

        if transfer_id:
            self._transfer_progress[transfer_id] = {
                "progress": 0, "bytes_transferred": 0,
                "speed_bps": 0, "total_size": total,
            }

        batch: list[str] = []
        current_len = len("rm -rf")

        async def flush(batch: list[str]) -> None:
            nonlocal deleted
            if not batch:
                return
            args = " ".join(f"'{self._shell_escape(p)}'" for p in batch)
            cmd = f"rm -rf {args}"
            stdout, stderr, code = await self._run_command(
                "shell", cmd, device_id=device_id
            )
            if code != 0 or "Permission denied" in stderr:
                raise ADBError(f"Bulk delete failed: {stderr or stdout}")
            # Verify items were actually deleted
            still_exist = []
            for p in batch:
                esc = self._shell_escape(p)
                chk, _, _ = await self._run_command(
                    "shell", f"[ -e '{esc}' ] && echo EXISTS",
                    device_id=device_id
                )
                if "EXISTS" in chk:
                    still_exist.append(p)
            if still_exist:
                raise ADBError(
                    f"Bulk delete failed: {len(still_exist)} item(s) still exist"
                )
            deleted += len(batch)
            if transfer_id and transfer_id in self._transfer_progress:
                pct = int(deleted / total * 100) if total else 100
                self._transfer_progress[transfer_id] = {
                    "progress": pct, "bytes_transferred": deleted,
                    "speed_bps": 0, "total_size": total,
                }

        try:
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
        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)

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
                "speed_bps": 0, "total_size": 0,
                "files_completed": 0, "files_total": total,
            }

        try:
            for remote_path in remote_paths:
                # Check for cancellation
                if transfer_id:
                    with self._transfers_lock:
                        if transfer_id in self._cancelled_transfers:
                            raise ADBError("Transfer cancelled")

                filename = os.path.basename(remote_path)
                if transfer_id and transfer_id in self._transfer_progress:
                    self._transfer_progress[transfer_id]["current_file"] = remote_path
                local_dest = os.path.join(local_dir, filename)
                # Avoid overwriting if multiple remote files share the same name
                if os.path.exists(local_dest):
                    base, ext = os.path.splitext(filename)
                    counter = 1
                    while os.path.exists(local_dest):
                        local_dest = os.path.join(local_dir, f"{base} ({counter}){ext}")
                        counter += 1
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
                    done = completed + failed
                    self._transfer_progress[transfer_id] = {
                        "progress": int(done / total * 100),
                        "bytes_transferred": 0,
                        "speed_bps": 0,
                        "total_size": 0,
                        "files_completed": done,
                        "files_total": total,
                        "current_file": remote_path,
                    }

        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)
                with self._transfers_lock:
                    self._cancelled_transfers.discard(transfer_id)

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
    
    # Linux USB gadget speed names -> (label, nominal bits per second)
    _USB_SPEEDS = {
        "super-speed-plus": ("SuperSpeed+ · USB 3.2 Gen 2 · 10 Gbps", 10_000_000_000),
        "super-speed": ("SuperSpeed · USB 3.2 Gen 1 · 5 Gbps", 5_000_000_000),
        "high-speed": ("High-Speed · USB 2.0 · 480 Mbps", 480_000_000),
        "full-speed": ("Full-Speed · USB 1.1 · 12 Mbps", 12_000_000),
        "low-speed": ("Low-Speed · USB 1.0 · 1.5 Mbps", 1_500_000),
    }

    _BATTERY_STATUS = {
        "1": "Unknown", "2": "Charging", "3": "Discharging",
        "4": "Not charging", "5": "Full",
    }

    async def _get_adb_version(self) -> Optional[str]:
        if getattr(self, "_adb_version", None) is None:
            try:
                stdout, _, code = await self._run_command("version", timeout=10)
                m = re.search(r"Version\s+(\S+)", stdout) or re.search(r"version\s+(\S+)", stdout)
                self._adb_version = m.group(1) if (code == 0 and m) else ""
            except ADBError:
                self._adb_version = ""
        return self._adb_version or None

    async def get_connection_info(self, device_id: str) -> ConnectionInfo:
        """
        Describe how the device is connected.

        Everything comes from one `adb shell` call that reads:
          - /sys/class/udc/*        the device's USB controller: negotiated
                                    link speed, max speed, state
          - getprop sys.usb.config  active USB functions (mtp, adb, ...)
          - /sys/class/power_supply/usb  VBUS voltage/current (if readable)
          - dumpsys battery         power source, level, temperature
        Any of these can be hidden by SELinux on some devices; missing
        values are simply returned as null.
        """
        is_wifi = ":" in device_id or "_adb-tls-connect" in device_id
        script = (
            'for d in /sys/class/udc/*; do '
            '[ -e "$d/current_speed" ] && echo "udc=${d##*/}|$(cat "$d/current_speed" 2>/dev/null)'
            '|$(cat "$d/maximum_speed" 2>/dev/null)|$(cat "$d/state" 2>/dev/null)"; '
            'done; '
            'echo "usb_config=$(getprop sys.usb.config)"; '
            'echo "android=$(getprop ro.build.version.release)"; '
            'echo "sdk=$(getprop ro.build.version.sdk)"; '
            'echo "manufacturer=$(getprop ro.product.manufacturer)"; '
            'echo "model=$(getprop ro.product.model)"; '
            'echo "vbus_uv=$(cat /sys/class/power_supply/usb/voltage_now 2>/dev/null)"; '
            'echo "vbus_ua=$(cat /sys/class/power_supply/usb/current_now 2>/dev/null)"; '
            'dumpsys battery 2>/dev/null'
        )
        stdout, stderr, code = await self._run_command(
            "shell", script, device_id=device_id, timeout=15
        )
        if code != 0 and not stdout.strip():
            raise ADBError(f"Failed to read connection info: {stderr or stdout}")

        kv: Dict[str, str] = {}
        udcs: List[List[str]] = []
        battery: Dict[str, str] = {}
        for raw in stdout.splitlines():
            line = raw.strip()
            if line.startswith("udc="):
                udcs.append(line[4:].split("|"))
            elif "=" in line and not raw.startswith(" "):
                k, v = line.split("=", 1)
                kv[k] = v.strip()
            elif ":" in line:
                k, v = line.split(":", 1)
                battery[k.strip().lower()] = v.strip()

        # Prefer the controller that is actually configured (connected to a host)
        udc = None
        for u in udcs:
            if len(u) >= 2 and u[1] and u[1].lower() not in ("unknown", ""):
                udc = u
                if len(u) >= 4 and u[3] == "configured":
                    break
        speed = udc[1].strip().lower() if udc else None
        max_speed = udc[2].strip().lower() if udc and len(udc) > 2 and udc[2] else None

        def to_int(v: Optional[str]) -> Optional[int]:
            try:
                return int(v) if v not in (None, "") else None
            except ValueError:
                return None

        vbus_uv = to_int(kv.get("vbus_uv"))
        vbus_ua = to_int(kv.get("vbus_ua"))

        if battery.get("usb powered") == "true":
            power = "USB"
        elif battery.get("ac powered") == "true":
            power = "AC"
        elif battery.get("wireless powered") == "true":
            power = "Wireless"
        elif battery:
            power = "Battery"
        else:
            power = None

        temp = to_int(battery.get("temperature"))

        # Find this device's USB path from `adb devices -l`
        usb_path = None
        try:
            for d in await self.get_devices():
                if d.id == device_id:
                    usb_path = d.usb
                    break
        except ADBError:
            pass

        return ConnectionInfo(
            transport="wifi" if is_wifi else "usb",
            usb_path=usb_path,
            usb_speed=None if is_wifi else speed,
            usb_speed_label=None if is_wifi else (self._USB_SPEEDS.get(speed, (speed, None))[0] if speed else None),
            usb_speed_bps=None if is_wifi else (self._USB_SPEEDS.get(speed, (None, None))[1] if speed else None),
            usb_max_speed=max_speed,
            usb_max_speed_label=self._USB_SPEEDS.get(max_speed, (max_speed, None))[0] if max_speed else None,
            usb_controller=udc[0] if udc else None,
            usb_functions=kv.get("usb_config") or None,
            usb_voltage_mv=vbus_uv // 1000 if vbus_uv else None,
            usb_current_ma=abs(vbus_ua) // 1000 if vbus_ua else None,
            power_source=power,
            battery_level=to_int(battery.get("level")),
            battery_status=self._BATTERY_STATUS.get(battery.get("status", ""), None),
            battery_temp_c=temp / 10 if temp is not None else None,
            manufacturer=kv.get("manufacturer") or None,
            model=kv.get("model") or None,
            android_version=kv.get("android") or None,
            sdk=to_int(kv.get("sdk")),
            adb_version=await self._get_adb_version(),
        )

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
