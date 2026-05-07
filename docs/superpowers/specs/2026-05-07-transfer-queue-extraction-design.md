# Transfer Queue Extraction — Design Spec

**Date:** 2026-05-07
**Status:** Approved

## Problem

`App.tsx` (~530 lines) owns all transfer logic: the serial queue (`queueTail` ref), progress polling (`startProgressPoll`), speed history accumulation, cancel handling, and the full enqueue-execute-update lifecycle. Every operation handler (`handleUpload`, `handleUploadFolder`, `handleDownload`, `handleDelete`) duplicates a ~20-line try/catch/poll/status block. Adding any new operation (move, copy, bulk upload) forces changes deep inside App.tsx.

## Solution

Extract transfer state and lifecycle into `useTransferQueue` — a custom React hook following existing codebase conventions (`useDevices`, `useFileBrowser`).

## Boundary

### Moves into the hook

- **State:** `transfers`, `speedHistory`, `queueTail` ref
- **Functions:** `updateTransfer`, `dismissTransfer`, `clearCompletedTransfers`, `enqueueTransfer`, `cancelTransfer`, `startProgressPoll`
- **Effect:** "Clear speed history when all transfers finish"
- **ID generation:** `itemId` and `transferId` construction

### Stays in App.tsx

- **User-intent handlers:** `handleUpload`, `handleUploadFolder`, `handleDownload`, `handleDelete` — they know *what* to transfer and call `enqueue()`.
- **Toast notifications** — UI concern, stays in App.tsx. Wired via `onSuccess`/`onError` callbacks.
- **File list refresh** — wired via `onComplete` callback.

## Hook API

```ts
// src/hooks/useTransferQueue.ts

interface EnqueueOptions {
  fileName: string;
  direction: TransferDirection;
  deviceId: string;
  /** The async API call. Receives the backend transfer_id. */
  execute: (transferId: string) => Promise<OperationResult | void>;
  /** Called after transfer finishes (success or failure). For refresh(). */
  onComplete?: () => void;
  /** Called on success with the API result. For toasts. */
  onSuccess?: (result?: OperationResult) => void;
  /** Called on failure with the error message. For toasts. */
  onError?: (message: string) => void;
}

interface TransferQueueHook {
  transfers: TransferItem[];
  speedHistory: { time: number; speed: number }[];
  enqueue: (options: EnqueueOptions) => void;
  dismiss: (id: string) => void;
  clearCompleted: () => void;
}

function useTransferQueue(): TransferQueueHook
```

## Internal Lifecycle

When `enqueue()` is called:

1. Generate `itemId` (`{direction}-{timestamp}-{random}`) and `transferId` (`t-{timestamp}-{random}`).
2. Create `TransferItem` with status `'queued'`, wire `onCancel` to call `fileApi.cancelTransfer(deviceId, transferId)`.
3. Add to `transfers` state immediately.
4. Chain onto `queueTail` promise (serial execution).
5. When this transfer's turn arrives:
   - Mark `'active'`.
   - Start progress poll (500ms interval polling `fileApi.getProgress`).
   - Call `execute(transferId)`.
6. On success:
   - Stop poll.
   - Push `speed: 0` sentinel to `speedHistory`.
   - Mark `'completed'` (progress 100, speedBps 0, clear onCancel).
   - Call `onSuccess(result)`, then `onComplete()`.
7. On error:
   - Stop poll.
   - Detect cancellation (`message.includes('cancel')`).
   - Mark `'cancelled'` or `'failed'`.
   - Call `onError(message)` (only for non-cancel failures), then `onComplete()`.

Speed history auto-clears via an effect when all transfers leave active/queued states.

## Type Relocation

`TransferItem`, `TransferDirection`, and `TransferStatus` move from `TransferQueue.tsx` to `types.ts`. Both the hook and the component import from `types.ts`.

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useTransferQueue.ts` | New — hook implementation (~100 lines) |
| `src/types.ts` | Add `TransferItem`, `TransferDirection`, `TransferStatus` |
| `src/App.tsx` | Remove ~200 lines of transfer logic; use `useTransferQueue()` |
| `src/components/TransferQueue.tsx` | Import types from `../types` instead of defining locally |

No backend changes. No new dependencies.

## Example: handleUpload After

```ts
const handleUpload = useCallback(async () => {
  if (!selectedDevice) return;
  const deviceId = selectedDevice.id;
  const paths = await localApi.pickFiles('', 'Select Files to Upload');
  if (paths.length === 0) return;

  for (const localPath of paths) {
    const name = localPath.replace(/\\/g, '/').split('/').pop() || localPath;
    enqueue({
      fileName: name,
      direction: 'push',
      deviceId,
      execute: (transferId) => fileApi.pushLocal(deviceId, localPath, currentPath, transferId),
      onComplete: refresh,
    });
  }
}, [selectedDevice, currentPath, enqueue, refresh]);
```

Compare to the current 25-line version with inline try/catch/poll/status management.

## Non-Goals

- No WebSocket/SSE migration (separate concern).
- No context provider (only App.tsx and TransferQueue need the data; props are sufficient).
- No external state library.
