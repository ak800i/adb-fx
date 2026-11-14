import { useCallback, useEffect, useState } from 'react';
import { Usb, Wifi, ChevronDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { deviceApi } from '../services/api';
import type { ConnectionInfo } from '../types';
import styles from './ConnectionPanel.module.css';

interface ConnectionPanelProps {
  deviceId: string;
  /** Combined speed of active transfers (bytes/s), used for the link-usage bar */
  transferSpeedBps: number;
}

const POLL_IDLE_MS = 5000;
// Poll less often while copying: every poll is an extra `adb shell` call
const POLL_BUSY_MS = 15000;

/** Rank of each Linux USB speed name, to tell if the link is slower than the device can do */
const SPEED_RANK: Record<string, number> = {
  'low-speed': 0,
  'full-speed': 1,
  'high-speed': 2,
  'super-speed': 3,
  'super-speed-plus': 4,
};

function formatBits(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(bps >= 1e10 ? 0 : 1)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(0)} Mbps`;
  return `${(bps / 1e3).toFixed(0)} Kbps`;
}

export function ConnectionPanel({ deviceId, transferSpeedBps }: ConnectionPanelProps) {
  const [open, setOpen] = useState(true);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const busy = transferSpeedBps > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await deviceApi.getConnectionInfo(deviceId);
      setInfo(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read connection info');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Reset when switching devices
  useEffect(() => {
    setInfo(null);
    setError(null);
  }, [deviceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tick = () => { if (!cancelled) load(); };
    tick();
    const id = setInterval(tick, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, busy, load]);

  const isWifi = info?.transport === 'wifi';
  const speedRank = info?.usb_speed ? SPEED_RANK[info.usb_speed] : undefined;
  const maxRank = info?.usb_max_speed ? SPEED_RANK[info.usb_max_speed] : undefined;
  const slowerThanCapable = speedRank != null && maxRank != null && speedRank < maxRank;
  const isUsb2OrSlower = speedRank != null && speedRank <= 2;

  const linkUsagePct =
    busy && info?.usb_speed_bps ? Math.min(100, ((transferSpeedBps * 8) / info.usb_speed_bps) * 100) : null;

  const rows: [string, string][] = [];
  if (info) {
    rows.push([
      'Transport',
      isWifi ? 'Wi-Fi (TCP/IP)' : `USB${info.usb_path ? ` · bus ${info.usb_path}` : ''}`,
    ]);
    if (info.usb_functions) rows.push(['USB mode', info.usb_functions]);
    if (info.usb_max_speed_label && slowerThanCapable) rows.push(['Device max', info.usb_max_speed_label]);
    if (info.usb_controller) rows.push(['Controller', info.usb_controller]);
    const power: string[] = [];
    if (info.power_source) power.push(info.power_source);
    if (info.usb_voltage_mv) power.push(`${(info.usb_voltage_mv / 1000).toFixed(2)} V`);
    if (info.usb_current_ma) power.push(`${(info.usb_current_ma / 1000).toFixed(2)} A`);
    if (power.length) rows.push(['Power', power.join(' · ')]);
    const batt: string[] = [];
    if (info.battery_level != null) batt.push(`${info.battery_level}%`);
    if (info.battery_status) batt.push(info.battery_status);
    if (info.battery_temp_c != null) batt.push(`${info.battery_temp_c.toFixed(1)} °C`);
    if (batt.length) rows.push(['Battery', batt.join(' · ')]);
    const dev = [info.manufacturer, info.model].filter(Boolean).join(' ');
    if (dev) rows.push(['Device', dev]);
    if (info.android_version) {
      rows.push(['Android', `${info.android_version}${info.sdk ? ` (API ${info.sdk})` : ''}`]);
    }
    if (info.adb_version) rows.push(['Host ADB', info.adb_version]);
  }

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setOpen((o) => !o)}>
        {isWifi ? <Wifi size={16} /> : <Usb size={16} />}
        <span>Connection</span>
        <button
          className={styles.iconBtn}
          title="Refresh"
          onClick={(e) => {
            e.stopPropagation();
            load();
          }}
        >
          <RefreshCw size={14} className={loading ? styles.spinning : undefined} />
        </button>
        <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </div>

      {open && (
        <div className={styles.body}>
          {error && !info && <div className={styles.error}>{error}</div>}
          {!info && !error && <div className={styles.muted}>Reading connection…</div>}

          {info && (
            <>
              {/* Link speed — the headline number */}
              <div className={styles.speedBlock}>
                <span className={styles.label}>Link speed</span>
                {isWifi ? (
                  <span className={styles.speed}>Wireless — no USB link</span>
                ) : info.usb_speed_label ? (
                  <span className={`${styles.speed} ${isUsb2OrSlower ? styles.speedSlow : ''}`}>
                    {info.usb_speed_label}
                  </span>
                ) : (
                  <span className={styles.muted}>Not readable on this device</span>
                )}
              </div>

              {!isWifi && (slowerThanCapable || isUsb2OrSlower) && (
                <div className={styles.warning}>
                  <AlertTriangle size={13} />
                  <span>
                    {slowerThanCapable
                      ? 'Running slower than the device supports. '
                      : 'USB 2.0 link. '}
                    Try a USB 3 (blue / SS) port and a data cable rated for USB 3.
                  </span>
                </div>
              )}

              {linkUsagePct != null && info.usb_speed_bps && (
                <div className={styles.usage}>
                  <div className={styles.usageRow}>
                    <span className={styles.label}>Link in use</span>
                    <span className={styles.value}>
                      {formatBits(transferSpeedBps * 8)} of {formatBits(info.usb_speed_bps)}
                    </span>
                  </div>
                  <div className={styles.meter}>
                    <div className={styles.meterFill} style={{ width: `${Math.max(1, linkUsagePct)}%` }} />
                  </div>
                </div>
              )}

              <dl className={styles.rows}>
                {rows.map(([k, v]) => (
                  <div key={k} className={styles.row}>
                    <dt className={styles.label}>{k}</dt>
                    <dd className={styles.value} title={v}>{v}</dd>
                  </div>
                ))}
              </dl>

              {error && <div className={styles.error}>Last refresh failed: {error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
