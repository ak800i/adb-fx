import { useState, useCallback } from 'react';
import { Wifi, ChevronDown, Loader } from 'lucide-react';
import { deviceApi } from '../services/api';
import type { Device } from '../types';
import styles from './WirelessConnect.module.css';

type Tab = 'connect' | 'pair' | 'tcpip';

interface WirelessConnectProps {
  /** USB-connected devices that can be switched to TCP/IP mode */
  usbDevices: Device[];
  onConnected: () => void;
}

const STORAGE_KEY = 'adb-fx:wireless-ip';

function getSavedIp(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

function saveIp(ip: string) {
  try { localStorage.setItem(STORAGE_KEY, ip); } catch { /* ignore */ }
}

export function WirelessConnect({ usbDevices, onConnected }: WirelessConnectProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('connect');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Connect form — pre-fill IP from localStorage
  const [address, setAddress] = useState(getSavedIp);
  const [port, setPort] = useState('5555');

  // Pair form — pre-fill IP from localStorage (port/code rotate, left empty)
  const [pairAddress, setPairAddress] = useState(getSavedIp);
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');

  const clearStatus = () => setStatus(null);

  const handleConnect = useCallback(async () => {
    if (!address.trim()) return;
    setLoading(true);
    clearStatus();
    try {
      const res = await deviceApi.wirelessConnect(address.trim(), parseInt(port) || 5555);
      if (res.success) saveIp(address.trim());
      setStatus({ ok: res.success, msg: res.message });
      onConnected();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setLoading(false);
    }
  }, [address, port, onConnected]);

  const handleDisconnect = useCallback(async () => {
    if (!address.trim()) return;
    setLoading(true);
    clearStatus();
    try {
      const res = await deviceApi.wirelessDisconnect(address.trim(), parseInt(port) || 5555);
      setStatus({ ok: true, msg: res.message });
      onConnected();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Disconnect failed' });
    } finally {
      setLoading(false);
    }
  }, [address, port, onConnected]);

  const handlePair = useCallback(async () => {
    if (!pairAddress.trim() || !pairPort.trim() || !pairCode.trim()) return;
    setLoading(true);
    clearStatus();
    try {
      const res = await deviceApi.wirelessPair(
        pairAddress.trim(),
        parseInt(pairPort),
        pairCode.trim(),
      );
      if (res.success) saveIp(pairAddress.trim());
      setStatus({ ok: res.success, msg: res.message });
      onConnected();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Pairing failed' });
    } finally {
      setLoading(false);
    }
  }, [pairAddress, pairPort, pairCode, onConnected]);

  const handleTcpip = useCallback(async (deviceId: string) => {
    setLoading(true);
    clearStatus();
    try {
      const res = await deviceApi.wirelessTcpip(deviceId);
      setStatus({ ok: res.success, msg: res.message + ' — Now connect using the device IP.' });
      onConnected();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Failed to switch mode' });
    } finally {
      setLoading(false);
    }
  }, [onConnected]);

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setOpen((o) => !o)}>
        <Wifi size={18} />
        <span>Wireless ADB</span>
        <ChevronDown
          size={16}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
      </div>

      {open && (
        <div className={styles.body}>
          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'connect' ? styles.tabActive : ''}`}
              onClick={() => { setTab('connect'); clearStatus(); }}
            >
              Connect
            </button>
            <button
              className={`${styles.tab} ${tab === 'pair' ? styles.tabActive : ''}`}
              onClick={() => { setTab('pair'); clearStatus(); }}
            >
              Pair
            </button>
            <button
              className={`${styles.tab} ${tab === 'tcpip' ? styles.tabActive : ''}`}
              onClick={() => { setTab('tcpip'); clearStatus(); }}
            >
              USB → Wi-Fi
            </button>
          </div>

          {/* Connect tab */}
          {tab === 'connect' && (
            <div className={styles.form}>
              <div className={styles.row}>
                <div className={styles.inputGroup}>
                  <label>IP Address</label>
                  <input
                    type="text"
                    placeholder="192.168.1.100"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  />
                </div>
                <div className={`${styles.inputGroup} ${styles.portInput}`}>
                  <label>Port</label>
                  <input
                    type="text"
                    placeholder="5555"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  />
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.connectBtn}
                  onClick={handleConnect}
                  disabled={loading || !address.trim()}
                >
                  {loading ? <Loader size={14} className={styles.chevron} /> : null}
                  Connect
                </button>
                <button
                  className={styles.connectBtn}
                  onClick={handleDisconnect}
                  disabled={loading || !address.trim()}
                  style={{ background: 'var(--bg-tertiary)' }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Pair tab */}
          {tab === 'pair' && (
            <div className={styles.form}>
              <div className={styles.row}>
                <div className={styles.inputGroup}>
                  <label>IP Address</label>
                  <input
                    type="text"
                    placeholder="192.168.1.100"
                    value={pairAddress}
                    onChange={(e) => setPairAddress(e.target.value)}
                  />
                </div>
                <div className={`${styles.inputGroup} ${styles.portInput}`}>
                  <label>Port</label>
                  <input
                    type="text"
                    placeholder="37XXX"
                    value={pairPort}
                    onChange={(e) => setPairPort(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.inputGroup}>
                <label>Pairing Code</label>
                <input
                  type="text"
                  placeholder="123456"
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePair()}
                />
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.connectBtn}
                  onClick={handlePair}
                  disabled={loading || !pairAddress.trim() || !pairPort.trim() || !pairCode.trim()}
                >
                  {loading ? <Loader size={14} /> : null}
                  Pair Device
                </button>
              </div>
              <div className={styles.hint}>
                On your device, go to <strong>Settings → Developer Options → Wireless Debugging</strong> and tap <strong>Pair device with pairing code</strong>.
              </div>
            </div>
          )}

          {/* TCP/IP tab */}
          {tab === 'tcpip' && (
            <div className={styles.form}>
              {usbDevices.length === 0 ? (
                <div className={styles.hint}>
                  No USB devices connected. Plug in a device via USB first, then switch it to wireless mode here.
                </div>
              ) : (
                <>
                  <div className={styles.hint} style={{ padding: 0 }}>
                    Click a USB device to switch it to wireless mode:
                  </div>
                  <div className={styles.usbDeviceList}>
                    {usbDevices.map((d) => (
                      <button
                        key={d.id}
                        className={styles.usbDeviceBtn}
                        onClick={() => handleTcpip(d.id)}
                        disabled={loading}
                      >
                        <span className={styles.usbDeviceName}>{d.model || d.id}</span>
                        <span className={styles.switchLabel}>Switch →</span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.hint}>
                    <ol>
                      <li>Click a device above to enable TCP/IP mode</li>
                      <li>Disconnect the USB cable</li>
                      <li>Use the <strong>Connect</strong> tab with the device's IP address</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Status message */}
          {status && (
            <div
              className={`${styles.statusMsg} ${status.ok ? styles.statusSuccess : styles.statusError}`}
              style={{ marginTop: 8 }}
            >
              {status.msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
