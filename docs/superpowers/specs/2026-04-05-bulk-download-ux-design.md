# Bulk Download UX Improvement — Design Spec

## Problem

When a user selects a large number of files (e.g., 499) and initiates a download, the UI appears frozen for 50–100 seconds before any download begins. The transfer queue shows the item as "active" with 0% progress and no explanation.

### Root Cause

The backend `bulk_pull()` method (in `backend/app/adb.py`) runs `adb shell stat -c %s` synchronously for **every file** to compute total byte size before downloading the first file. Each stat call takes ~100–200ms. For 499 files, this means 50–100 seconds of blocking size-calculation before any data transfer begins and before the progress monitor can start.

During this phase:
- The frontend shows 0% progress with no speed indicator
- There is no visual distinction between "calculating sizes" and "nothing is happening"
- The user has no way to know the system is working

## Solution

Replace the blocking per-file size pre-scan with **count-based progress** for bulk pulls. Instead of computing total bytes upfront, track `completed_files / total_files`. Files begin downloading immediately.

### Backend Changes (`backend/app/adb.py` — `bulk_pull` method)

1. **Remove** the loop that calls `_get_remote_file_size_sync()` for every file before pulling.
2. **Remove** the `_start_progress_monitor()` call (byte-level monitoring is unnecessary for bulk pulls).
3. **Update** `_transfer_progress` after each file completes with count-based progress:
   ```python
   self._transfer_progress[transfer_id] = {
       "progress": int((completed + failed) / total * 100),
       "bytes_transferred": 0,
       "speed_bps": 0,
       "total_size": 0,
       "files_completed": completed + failed,
       "files_total": total,
   }
   ```

### Backend Changes (`backend/app/routes/files.py` — `get_progress` endpoint)

1. Pass through the new `files_completed` and `files_total` fields in the progress response.

### Frontend Changes (`frontend/src/services/api.ts` — `getProgress`)

1. Extend the return type to include optional `filesCompleted` and `filesTotal` fields.

### Frontend Changes (`frontend/src/components/TransferQueue.tsx`)

1. Add `filesCompleted` and `filesTotal` optional fields to `TransferItem`.
2. When these fields are present and `status === 'active'`, display **"42 of 499 files"** below the file name instead of (or alongside) the percentage.

### Frontend Changes (`frontend/src/App.tsx`)

1. In `startProgressPoll`, propagate `filesCompleted` and `filesTotal` from the API response into the transfer item state.

## What This Does NOT Change

- Single-file pull behavior (unchanged — still uses byte-level progress)
- Upload behavior (unchanged)
- The ≤200-file per-file download path (unchanged — each file gets its own transfer item)
- The bulk path threshold (stays at >200)
- Cancel functionality (unchanged)

## Success Criteria

- Selecting 499 files and downloading them: the first file begins transferring within 1–2 seconds (no pre-scan delay)
- The transfer queue shows "1 of 499 files" → "2 of 499 files" → ... → "499 of 499 files"
- The progress bar advances proportionally to file count
- Cancel still works mid-bulk-download
