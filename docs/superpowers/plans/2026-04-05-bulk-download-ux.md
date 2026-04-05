# Bulk Download UX Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 50–100 second delay before bulk downloads start by replacing pre-scan byte-level progress with count-based file progress.

**Architecture:** Remove the blocking per-file `stat` loop from `bulk_pull()`. Track progress as `completed_files / total_files`. Propagate `files_completed`/`files_total` through the API to the frontend `TransferQueue` component for display as "X of Y files".

**Tech Stack:** Python/FastAPI backend, React/TypeScript frontend

---

### Task 1: Backend — Switch bulk_pull to count-based progress

**Files:**
- Modify: `backend/app/adb.py:841-910` (the `bulk_pull` method)

- [ ] **Step 1: Remove the per-file size pre-scan and byte-level monitor**

In `backend/app/adb.py`, in the `bulk_pull` method, replace the block that loops over `remote_paths` to call `_get_remote_file_size_sync` and the `_start_progress_monitor` call with immediate count-based progress initialization.

Replace lines 860–871 (the `if transfer_id:` block before the `try:`) with:

```python
        if transfer_id:
            self._transfer_progress[transfer_id] = {
                "progress": 0, "bytes_transferred": 0,
                "speed_bps": 0, "total_size": 0,
                "files_completed": 0, "files_total": total,
            }
```

This removes:
- The `for rp in remote_paths:` loop calling `self._get_remote_file_size_sync(device_id, rp)`
- The `total_bytes` accumulation
- The `if total_bytes > 0:` block with `_start_progress_monitor`

- [ ] **Step 2: Add per-file progress update after each pull**

Inside the `for remote_path in remote_paths:` loop, after each successful or failed pull (after `completed += 1` or `failed += 1`), add a progress update:

```python
                if transfer_id:
                    done = completed + failed
                    self._transfer_progress[transfer_id] = {
                        "progress": int(done / total * 100),
                        "bytes_transferred": 0,
                        "speed_bps": 0,
                        "total_size": 0,
                        "files_completed": done,
                        "files_total": total,
                    }
```

This goes inside the inner `try/except` block, after both the `completed += 1` line and the `failed += 1` line (use two insertions, or restructure so both paths converge on the update). The cleanest approach: add the update after the inner `try/except` block so it runs regardless of success or failure.

- [ ] **Step 3: Verify the `finally` block still cleans up**

The existing `finally` block at the end of `bulk_pull` already does:
```python
        finally:
            if transfer_id:
                self._transfer_progress.pop(transfer_id, None)
                with self._transfers_lock:
                    self._cancelled_transfers.discard(transfer_id)
```

This is correct and needs no changes. Just verify it's still intact.

- [ ] **Step 4: Test manually (or read through the logic) to confirm**

The method should now:
1. Initialize progress immediately (no delay)
2. Pull files one by one (existing behavior)
3. Update progress after each file completes
4. Clean up on completion

---

### Task 2: Backend — Pass files_completed/files_total in progress endpoint

**Files:**
- Modify: `backend/app/routes/files.py:120-130` (the `get_progress` endpoint)

- [ ] **Step 1: Add files_completed and files_total to the progress response**

In `backend/app/routes/files.py`, in the `get_progress` endpoint, the current return dict is:

```python
    return {
        "transfer_id": transfer_id,
        "progress": info.get("progress"),
        "speed_bps": info.get("speed_bps", 0),
        "bytes_transferred": info.get("bytes_transferred", 0),
        "total_size": info.get("total_size", 0),
    }
```

Add two more fields:

```python
    return {
        "transfer_id": transfer_id,
        "progress": info.get("progress"),
        "speed_bps": info.get("speed_bps", 0),
        "bytes_transferred": info.get("bytes_transferred", 0),
        "total_size": info.get("total_size", 0),
        "files_completed": info.get("files_completed"),
        "files_total": info.get("files_total"),
    }
```

These will be `None` for non-bulk transfers (single file pull/push), which is fine — the frontend will check for their presence.

---

### Task 3: Frontend — Extend API service and TransferItem type

**Files:**
- Modify: `frontend/src/services/api.ts:170-183` (the `getProgress` method)
- Modify: `frontend/src/components/TransferQueue.tsx:17-28` (the `TransferItem` interface)

- [ ] **Step 1: Add fields to the getProgress return type**

In `frontend/src/services/api.ts`, in the `getProgress` method, the current return type and mapping is:

```typescript
  async getProgress(deviceId: string, transferId: string): Promise<{ progress: number; speedBps: number } | null> {
    ...
    return { progress: data.progress, speedBps: data.speed_bps ?? 0 };
  },
```

Change the return type and add the new fields:

```typescript
  async getProgress(deviceId: string, transferId: string): Promise<{
    progress: number;
    speedBps: number;
    filesCompleted?: number;
    filesTotal?: number;
  } | null> {
    const params = new URLSearchParams({ transfer_id: transferId });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/progress?${params}`
    );
    const data = await response.json();
    if (data.progress == null) return null;
    return {
      progress: data.progress,
      speedBps: data.speed_bps ?? 0,
      filesCompleted: data.files_completed ?? undefined,
      filesTotal: data.files_total ?? undefined,
    };
  },
```

- [ ] **Step 2: Add optional fields to TransferItem interface**

In `frontend/src/components/TransferQueue.tsx`, add two optional fields to the `TransferItem` interface:

```typescript
export interface TransferItem {
  id: string;
  transferId: string;
  fileName: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number; // 0-100
  speedBps: number; // bytes per second
  error?: string;
  onCancel?: () => void;
  filesCompleted?: number;
  filesTotal?: number;
}
```

---

### Task 4: Frontend — Propagate new fields in progress polling

**Files:**
- Modify: `frontend/src/App.tsx:155-170` (the `startProgressPoll` callback)

- [ ] **Step 1: Update startProgressPoll to pass filesCompleted and filesTotal**

In `frontend/src/App.tsx`, the `startProgressPoll` callback currently updates transfer state with:

```typescript
  const startProgressPoll = useCallback((deviceId: string, transferId: string, itemId: string) => {
    const interval = setInterval(async () => {
      try {
        const info = await fileApi.getProgress(deviceId, transferId);
        if (info !== null) {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === itemId && t.status === 'active'
                ? { ...t, progress: info.progress, speedBps: info.speedBps }
                : t
            )
          );
        }
      } catch {
        // ignore polling errors
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);
```

Change the state update to also propagate the new fields:

```typescript
                ? { ...t, progress: info.progress, speedBps: info.speedBps, filesCompleted: info.filesCompleted, filesTotal: info.filesTotal }
```

---

### Task 5: Frontend — Display "X of Y files" in TransferQueue

**Files:**
- Modify: `frontend/src/components/TransferQueue.tsx:108-156` (the transfer item rendering)

- [ ] **Step 1: Add file count display for active bulk transfers**

In `frontend/src/components/TransferQueue.tsx`, in the transfer item rendering section, after the progress bar for non-delete active transfers, add a line showing file count when `filesTotal` is present.

Find the block:

```tsx
                {t.status === 'active' && t.direction !== 'delete' && (
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                )}
```

Replace it with:

```tsx
                {t.status === 'active' && t.direction !== 'delete' && (
                  <>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                    {t.filesTotal != null && t.filesTotal > 0 && (
                      <span className={styles.fileCount}>
                        {t.filesCompleted ?? 0} of {t.filesTotal} files
                      </span>
                    )}
                  </>
                )}
```

- [ ] **Step 2: Add the fileCount CSS class**

In `frontend/src/components/TransferQueue.module.css`, add after the `.queued` class:

```css
.fileCount {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Commit all changes**

```bash
git add backend/app/adb.py backend/app/routes/files.py frontend/src/services/api.ts frontend/src/components/TransferQueue.tsx frontend/src/components/TransferQueue.module.css frontend/src/App.tsx
git commit -m "feat: eliminate bulk download delay with count-based progress

Replace blocking per-file stat pre-scan in bulk_pull with count-based
progress tracking. Files start downloading immediately instead of after
a 50-100s size calculation phase.

Transfer queue now shows 'X of Y files' for bulk downloads."
```
