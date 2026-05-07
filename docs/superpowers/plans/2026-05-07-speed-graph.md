# Speed Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an aggregate transfer speed graph (Recharts AreaChart) to the TransferQueue panel, showing speed over full transfer duration with auto show/hide.

**Architecture:** A new `SpeedGraph` component renders a Recharts `<AreaChart>` with gradient fill inside the TransferQueue panel. `App.tsx` collects speed data points during its existing 500ms progress polling, stores them in a `speedHistory` state array, and passes it to TransferQueue as a prop. The graph auto-shows when transfers are active and auto-hides when all complete.

**Tech Stack:** React 18, TypeScript, Recharts, CSS Modules

**Spec:** `docs/superpowers/specs/2026-05-07-speed-graph-design.md`

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/components/SpeedGraph.tsx` | **Create** — Recharts AreaChart component with gradient fill, formatted axes, tooltip |
| `frontend/src/components/SpeedGraph.module.css` | **Create** — Container wrapper class (120px height) |
| `frontend/src/components/TransferQueue.tsx` | **Modify** — Add `speedHistory` prop, extract `formatSpeed` as exported function, render `SpeedGraph` between header and list |
| `frontend/src/components/TransferQueue.module.css` | **Modify** — Bump `.panel` `max-height` from `220px` to `340px` |
| `frontend/src/App.tsx` | **Modify** — Add `speedHistory` state, collect speed data in poll callback, insert zero-speed on transfer complete, add clear-policy `useEffect`, pass `speedHistory` to `<TransferQueue>` |
| `frontend/package.json` | **Modify** — Add `recharts` dependency |

---

### Task 1: Install Recharts

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install recharts**

Run from the `frontend/` directory:

```bash
npm install recharts
```

This adds `recharts` to `dependencies` in `package.json`. Recharts depends on `d3-*` modules which are installed transitively.

- [ ] **Step 2: Verify installation**

Run:

```bash
cd frontend && npm ls recharts
```

Expected: shows `recharts@<version>` without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add recharts dependency"
```

---

### Task 2: Extract `formatSpeed` and Create SpeedGraph Component

**Files:**
- Modify: `frontend/src/components/TransferQueue.tsx` (lines 40-45 — `formatSpeed` function)
- Create: `frontend/src/components/SpeedGraph.tsx`
- Create: `frontend/src/components/SpeedGraph.module.css`

- [ ] **Step 1: Export `formatSpeed` from TransferQueue.tsx**

In `frontend/src/components/TransferQueue.tsx`, change the existing `formatSpeed` function from a local function to an exported one. Find:

```typescript
function formatSpeed(bps: number): string {
```

Replace with:

```typescript
export function formatSpeed(bps: number): string {
```

No other changes to this function. It remains in `TransferQueue.tsx` so existing usage stays the same.

- [ ] **Step 2: Create SpeedGraph.module.css**

Create `frontend/src/components/SpeedGraph.module.css`:

```css
.container {
  width: 100%;
  height: 120px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Create SpeedGraph.tsx**

Create `frontend/src/components/SpeedGraph.tsx`:

```tsx
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { formatSpeed } from './TransferQueue';
import styles from './SpeedGraph.module.css';

interface SpeedGraphProps {
  data: { time: number; speed: number }[];
}

/** Format millisecond offset to relative time label: "0s", "30s", "1m", "2m 30s" */
function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Custom tooltip rendered on hover */
function SpeedTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null;
  const speed = payload[0].value;
  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--accent)',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: 11,
        color: 'var(--text-primary)',
      }}
    >
      {formatSpeed(speed) || '0 B/s'}
    </div>
  );
}

export function SpeedGraph({ data }: SpeedGraphProps) {
  if (data.length < 2) return null;

  // Convert absolute timestamps to relative offsets from first data point
  const startTime = data[0].time;
  const chartData = data.map((d) => ({
    offset: d.time - startTime,
    speed: d.speed,
  }));

  return (
    <div className={styles.container}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="offset"
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatSpeed(v) || '0'}
            tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<SpeedTooltip />} />
          <Area
            type="monotone"
            dataKey="speed"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="url(#speedGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Key details:
- `isAnimationActive={false}` — disables Recharts entry animations since new points arrive every 500ms; animations would stutter.
- Gradient uses `var(--accent)` in SVG `<stop>` elements — works in all modern browsers.
- `formatTime` converts ms offset to human labels like "30s", "2m 30s".
- Tooltip uses the shared `formatSpeed` function.
- Y-axis width is `60` to accommodate labels like "12.5 MB/s".

- [ ] **Step 4: Verify build compiles**

Run:

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors. (SpeedGraph is not rendered anywhere yet, but it should compile.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SpeedGraph.tsx frontend/src/components/SpeedGraph.module.css frontend/src/components/TransferQueue.tsx
git commit -m "feat: add SpeedGraph component with Recharts AreaChart"
```

---

### Task 3: Integrate SpeedGraph into TransferQueue

**Files:**
- Modify: `frontend/src/components/TransferQueue.tsx`
- Modify: `frontend/src/components/TransferQueue.module.css`

- [ ] **Step 1: Bump panel max-height**

In `frontend/src/components/TransferQueue.module.css`, find:

```css
.panel {
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  max-height: 220px;
  flex-shrink: 0;
}
```

Change `max-height: 220px;` to `max-height: 340px;`.

- [ ] **Step 2: Add `speedHistory` prop and render SpeedGraph**

In `frontend/src/components/TransferQueue.tsx`:

**2a.** Add the import at the top, after the existing imports:

```typescript
import { SpeedGraph } from './SpeedGraph';
```

**2b.** Update `TransferQueueProps` interface to add the new prop. Find:

```typescript
interface TransferQueueProps {
  transfers: TransferItem[];
  onDismiss: (id: string) => void;
  onClearCompleted: () => void;
}
```

Replace with:

```typescript
interface TransferQueueProps {
  transfers: TransferItem[];
  speedHistory: { time: number; speed: number }[];
  onDismiss: (id: string) => void;
  onClearCompleted: () => void;
}
```

**2c.** Update the destructured props. Find:

```typescript
export function TransferQueue({ transfers, onDismiss, onClearCompleted }: TransferQueueProps) {
```

Replace with:

```typescript
export function TransferQueue({ transfers, speedHistory, onDismiss, onClearCompleted }: TransferQueueProps) {
```

**2d.** Render the graph between the header and the list. Find this block inside the `!collapsed` conditional:

```tsx
      {/* Transfer list */}
      {!collapsed && (
        <div className={styles.list}>
```

Replace with:

```tsx
      {/* Speed graph + transfer list */}
      {!collapsed && (
        <>
          {speedHistory.length > 1 && activeCount > 0 && (
            <SpeedGraph data={speedHistory} />
          )}
          <div className={styles.list}>
```

And find the closing `</div>` that pairs with `.list` followed by the closing of the `!collapsed` block:

```tsx
          ))}
        </div>
      )}
    </div>
  );
}
```

Replace with:

```tsx
          ))}
        </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build compiles**

Run:

```bash
cd frontend && npx tsc --noEmit
```

Expected: Compilation error in `App.tsx` because `<TransferQueue>` is now missing the required `speedHistory` prop. This is expected — we fix it in Task 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TransferQueue.tsx frontend/src/components/TransferQueue.module.css
git commit -m "feat: integrate SpeedGraph into TransferQueue panel"
```

---

### Task 4: Wire Up Speed History in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

This is the most complex task. Three changes to App.tsx: (1) add state, (2) collect data in poll callback, (3) add clear-policy useEffect, (4) pass prop, (5) insert zero-speed on transfer complete.

- [ ] **Step 1: Add `speedHistory` state**

In `frontend/src/App.tsx`, find the state declarations block:

```typescript
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [storageInfo, setStorageInfo] = useState<DeviceStorageInfo[]>([]);
```

Add after `storageInfo`:

```typescript
  const [speedHistory, setSpeedHistory] = useState<{ time: number; speed: number }[]>([]);
```

- [ ] **Step 2: Collect speed data in `startProgressPoll`**

In `frontend/src/App.tsx`, find the `startProgressPoll` callback. Currently it looks like:

```typescript
  const startProgressPoll = useCallback((deviceId: string, transferId: string, itemId: string) => {
    const interval = setInterval(async () => {
      try {
        const info = await fileApi.getProgress(deviceId, transferId);
        if (info !== null) {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === itemId && t.status === 'active'
                ? { ...t, progress: info.progress, speedBps: info.speedBps, filesCompleted: info.filesCompleted, filesTotal: info.filesTotal }
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

Add the `setSpeedHistory` call right after the `setTransfers` call inside the `if (info !== null)` block. Replace that entire callback with:

```typescript
  const startProgressPoll = useCallback((deviceId: string, transferId: string, itemId: string) => {
    const interval = setInterval(async () => {
      try {
        const info = await fileApi.getProgress(deviceId, transferId);
        if (info !== null) {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === itemId && t.status === 'active'
                ? { ...t, progress: info.progress, speedBps: info.speedBps, filesCompleted: info.filesCompleted, filesTotal: info.filesTotal }
                : t
            )
          );
          setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: info.speedBps }]);
        }
      } catch {
        // ignore polling errors
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);
```

The only addition is the single `setSpeedHistory(...)` line. `setSpeedHistory` is a React state setter (referentially stable), so the `[]` dependency array remains correct.

- [ ] **Step 3: Insert zero-speed data point on transfer complete**

Each execute callback in App.tsx calls `stopPolling()` then `updateTransfer(iid, { status: 'completed', ... })`. After each `stopPolling()` call, add a zero-speed data point so the graph drops to baseline between sequential transfers.

There are **5 places** where a transfer completes successfully (status → 'completed'). In each, add `setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: 0 }]);` right after the `stopPolling()` call.

**Location 1 — `handleUpload` success path (line ~177):**

Find:

```typescript
          await fileApi.pushLocal(deviceId, localPath, remoteDest, tid);
          stopPolling();
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

Replace with:

```typescript
          await fileApi.pushLocal(deviceId, localPath, remoteDest, tid);
          stopPolling();
          setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: 0 }]);
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

**Location 2 — `handleUploadFolder` success path (line ~212):**

Find:

```typescript
          await fileApi.pushLocal(deviceId, folder, remoteDest, tid);
          stopPolling();
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

Replace with:

```typescript
          await fileApi.pushLocal(deviceId, folder, remoteDest, tid);
          stopPolling();
          setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: 0 }]);
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

**Location 3 — `handleDownload` bulk pull success path (line ~250):**

Find:

```typescript
          const result = await fileApi.bulkPull(deviceId, paths, localDir, tid);
          stopPolling();
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

Replace with:

```typescript
          const result = await fileApi.bulkPull(deviceId, paths, localDir, tid);
          stopPolling();
          setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: 0 }]);
          updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

**Location 4 — `handleDownload` per-file pull success path (line ~275):**

Find:

```typescript
            await fileApi.pullToLocal(deviceId, remotePath, localDir, tid);
            stopPolling();
            updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

Replace with:

```typescript
            await fileApi.pullToLocal(deviceId, remotePath, localDir, tid);
            stopPolling();
            setSpeedHistory((prev) => [...prev, { time: Date.now(), speed: 0 }]);
            updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
```

**Location 5 — `handleDelete` success path (line ~310):**

Find:

```typescript
        await fileApi.bulkDelete(deviceId, paths, transferId);
        updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0 });
```

Note: delete doesn't track speed in the graph (no meaningful byte speed), so **skip this one** — no zero-speed insertion for delete operations.

- [ ] **Step 4: Add clear-policy useEffect**

In `frontend/src/App.tsx`, add this `useEffect` after the existing `useEffect` for loading files (the one with the `selectedDevice` dependency, around line 60). Place it right before the `// Toast helpers` comment:

```typescript
  // Clear speed history when all transfers finish
  useEffect(() => {
    if (
      transfers.length > 0 &&
      transfers.every((t) => t.status !== 'active' && t.status !== 'queued') &&
      speedHistory.length > 0
    ) {
      setSpeedHistory([]);
    }
  }, [transfers, speedHistory.length]);
```

- [ ] **Step 5: Pass `speedHistory` prop to TransferQueue**

In the JSX, find:

```tsx
              <TransferQueue
                transfers={transfers}
                onDismiss={dismissTransfer}
                onClearCompleted={clearCompletedTransfers}
              />
```

Replace with:

```tsx
              <TransferQueue
                transfers={transfers}
                speedHistory={speedHistory}
                onDismiss={dismissTransfer}
                onClearCompleted={clearCompletedTransfers}
              />
```

- [ ] **Step 6: Verify build compiles**

Run:

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Verify dev server starts**

Run:

```bash
cd frontend && npm run dev
```

Expected: Vite starts on port 5173 without errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire up speed history collection and pass to TransferQueue"
```
