import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { formatSpeed } from '../utils/formatSpeed';
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
