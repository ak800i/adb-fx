# Speed Graph — Design Spec

## Overview

Add an aggregate transfer speed graph to the TransferQueue panel, similar to the Windows file copy dialog. The graph shows transfer speed (bytes/sec) over the full duration of the current transfer session, using Recharts for rendering.

## Requirements

- **Scope**: One aggregate graph for all transfers combined (not per-transfer)
- **Rendering**: Recharts `<AreaChart>` with gradient fill
- **Time window**: Full transfer duration (no sliding window)
- **Visibility**: Auto show when transfers are active, auto hide when all complete
- **No backend changes**: Uses data already available from existing 500ms progress polling

## Data Collection

### Speed History Buffer

A new state array in `App.tsx`:

```typescript
const [speedHistory, setSpeedHistory] = useState<{ time: number; speed: number }[]>([]);
```

- **Source**: The existing 500ms progress polling already returns `speedBps` for the active transfer
- **On each poll tick**: Append `{ time: Date.now(), speed: activeTransfer.speedBps }` to `speedHistory`
- **Clear policy**: Clear the array when no active or queued transfers remain
- **Aggregate**: Shows a continuous speed timeline across sequential transfers in the same session

### Integration Point in App.tsx

Inside the existing `startProgressPoll` callback, after updating transfer progress via `updateTransfer()`, also call:

```typescript
setSpeedHistory(prev => [...prev, { time: Date.now(), speed: info.speedBps }]);
```

> **Note:** `setSpeedHistory` is a React state setter (referentially stable), so adding it inside `startProgressPoll` does not affect the existing `[]` dependency array.

### Inter-Transfer Gap Handling

When a transfer completes (inside each execute callback, after `stopPolling()`), insert a zero-speed data point so the graph drops to the baseline between sequential transfers rather than drawing a misleading flat line:

```typescript
setSpeedHistory(prev => [...prev, { time: Date.now(), speed: 0 }]);
```

### Clear Policy

Add a `useEffect` in `App.tsx` that watches the `transfers` array and clears the speed history when the entire session is done (no active or queued transfers remain but the array is non-empty):

```typescript
useEffect(() => {
  if (
    transfers.length > 0 &&
    transfers.every(t => t.status !== 'active' && t.status !== 'queued') &&
    speedHistory.length > 0
  ) {
    setSpeedHistory([]);
  }
}, [transfers, speedHistory.length]);
```

This cannot be done inside `startProgressPoll` or individual execute callbacks because no single callback knows whether subsequent queued transfers exist.

## SpeedGraph Component

### File Location

- `frontend/src/components/SpeedGraph.tsx`
- `frontend/src/components/SpeedGraph.module.css`

### Props

```typescript
interface SpeedGraphProps {
  data: { time: number; speed: number }[];
}
```

### Rendering

- `<ResponsiveContainer width="100%" height={120}>` wrapping `<AreaChart>`
- **Curve**: Monotone interpolation (`type="monotone"`) for smooth lines
- **Fill**: Linear gradient from accent color (top, ~40% opacity) to transparent (bottom)
- **Line**: Solid accent color, 1.5px stroke
- **Y-axis**: Auto-scaled, smart unit formatting (B/s → KB/s → MB/s), tick labels in `var(--text-secondary)` at 10px
- **X-axis**: Relative time labels (e.g., "0s", "30s", "1m", "2m 30s"), tick labels in `var(--text-secondary)` at 10px
- **Tooltip**: Dark background (`var(--bg-tertiary)`), accent border, shows formatted speed value
- **No grid lines**: Clean, minimal look
- **Background**: Transparent (inherits panel background)

### Conditional Rendering

Rendered inside `TransferQueue` between the header and the list, **inside the existing `!collapsed` conditional** (so the graph hides when the user collapses the panel), when:
- `speedHistory.length > 1` (need at least 2 points for a line)
- AND there is at least one active transfer

## TransferQueue Changes

### New Prop

```typescript
interface TransferQueueProps {
  transfers: TransferItem[];
  speedHistory: { time: number; speed: number }[];  // NEW
  onDismiss: (id: string) => void;
  onClearCompleted: () => void;
}
```

### Layout

```
┌─────────────────────────────────┐
│ Header (Transfers | badges)     │
├─────────────────────────────────┤
│ SpeedGraph (120px, when active) │
├─────────────────────────────────┤
│ Transfer item 1                 │
│ Transfer item 2                 │
│ ...                             │
└─────────────────────────────────┘
```

The graph appears between the header bar and the scrollable transfer list.

### Panel Max-Height

The existing `.panel` has `max-height: 220px`. With the graph (120px) + header (~32px) that leaves only ~68px for the transfer list. Bump `max-height` to `340px` in `TransferQueue.module.css` so the list retains adequate scroll space when the graph is visible.

## Styling

- **Theme**: Matches existing dark theme using CSS custom properties
- **Gradient definition**: Defined via `<defs>` + `<linearGradient>` inside the Recharts `<AreaChart>`
- **Colors**:
  - Line/fill: `var(--accent)` (Android green, `#3DDC84`)
  - Axis ticks: `var(--text-secondary)`
  - Tooltip background: `var(--bg-tertiary)`
  - Tooltip border: `var(--accent)`
- **Graph container**: No extra border/padding — sits flush in the panel between header and list
- **Font**: 10px for axis labels, `font-variant-numeric: tabular-nums` for consistent digit width
- **CSS vars in SVG**: Recharts renders SVG elements. Using `var(--accent)` in SVG `<stop stopColor>` and `<Area stroke>` works in all modern browsers but implementers should verify the gradient renders correctly.

### SpeedGraph.module.css Contents

The CSS module holds a single `.container` class for the graph wrapper:

```css
.container {
  width: 100%;
  height: 120px;
  flex-shrink: 0;
}
```

All other styling (gradient, stroke, axis ticks, tooltip) is configured via Recharts props and inline `<defs>` inside the SVG.

### Shared `formatSpeed` Utility

`TransferQueue.tsx` already has a `formatSpeed(bps)` function. The SpeedGraph needs the same formatting for Y-axis ticks and the tooltip. Extract `formatSpeed` into a shared location (e.g. a top-level `const` in `SpeedGraph.tsx` that imports it, or move the function to a small `utils.ts` — implementer's choice) rather than duplicating it.

## Dependencies

- `recharts` — add to `frontend/package.json`

## Performance Note

At 1 data point per 500ms, a 2-hour continuous transfer session produces ~14,400 points. Recharts handles this comfortably. No downsampling or sliding window is needed for expected usage patterns.

## Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add `recharts` dependency |
| `frontend/src/components/SpeedGraph.tsx` | New component |
| `frontend/src/components/SpeedGraph.module.css` | New styles (`.container` wrapper) |
| `frontend/src/components/TransferQueue.tsx` | Add `speedHistory` prop, render `SpeedGraph`, bump `max-height` |
| `frontend/src/components/TransferQueue.module.css` | Bump `.panel` `max-height` from `220px` to `340px` |
| `frontend/src/App.tsx` | Add `speedHistory` state, collect data in poll callback, insert zero-speed on transfer complete, add clear-policy `useEffect`, pass to TransferQueue |

## Out of Scope

- Per-transfer sparklines (aggregate only)
- Backend API changes
- Speed history persistence across page reloads
- Configurable time windows
