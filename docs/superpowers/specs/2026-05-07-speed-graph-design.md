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

When the last transfer completes (no active + no queued), clear:

```typescript
setSpeedHistory([]);
```

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

Rendered inside `TransferQueue` between the header and the list when:
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

## Styling

- **Theme**: Matches existing dark theme using CSS custom properties
- **Gradient definition**: Defined via `<defs>` + `<linearGradient>` inside the Recharts `<AreaChart>`
- **Colors**:
  - Line/fill: `var(--accent)` (teal)
  - Axis ticks: `var(--text-secondary)`
  - Tooltip background: `var(--bg-tertiary)`
  - Tooltip border: `var(--accent)`
- **Graph container**: No extra border/padding — sits flush in the panel between header and list
- **Font**: 10px for axis labels, `font-variant-numeric: tabular-nums` for consistent digit width

## Dependencies

- `recharts` — add to `frontend/package.json`

## Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add `recharts` dependency |
| `frontend/src/components/SpeedGraph.tsx` | New component |
| `frontend/src/components/SpeedGraph.module.css` | New styles |
| `frontend/src/components/TransferQueue.tsx` | Add `speedHistory` prop, render `SpeedGraph` |
| `frontend/src/App.tsx` | Add `speedHistory` state, collect data in poll callback, pass to TransferQueue |

## Out of Scope

- Per-transfer sparklines (aggregate only)
- Backend API changes
- Speed history persistence across page reloads
- Configurable time windows
