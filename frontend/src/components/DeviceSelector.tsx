import { useState } from 'react';
import type { Device } from '../types';
import { 
  Smartphone, 
  RefreshCw, 
  WifiOff, 
  AlertTriangle,
  Check,
  Unplug,
  Loader,
} from 'lucide-react';
import { deviceApi } from '../services/api';
import styles from './DeviceSelector.module.css';

/** Returns true if the device ID looks like a wireless connection (IP:port or mDNS TLS) */
function isWirelessDevice(device: Device): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(device.id)
    || device.id.includes('_adb-tls-connect');
}

interface DeviceSelectorProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelect: (device: Device) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function DeviceSelector({
  devices,
  selectedDevice,
  onSelect,
  onRefresh,
  loading,
}: DeviceSelectorProps) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const handleDisconnect = async (device: Device, e: React.MouseEvent) => {
    e.stopPropagation();
    setDisconnecting(device.id);
    try {
      // IP:port devices split cleanly; mDNS IDs are passed as the full address
      const ipPortMatch = device.id.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
      if (ipPortMatch) {
        await deviceApi.wirelessDisconnect(ipPortMatch[1], parseInt(ipPortMatch[2]));
      } else {
        await deviceApi.wirelessDisconnect(device.id);
      }
      onRefresh();
    } catch {
      // ignore — device list will update on next poll
    } finally {
      setDisconnecting(null);
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'device':
        return <Check size={14} className={styles.stateIconConnected} />;
      case 'offline':
        return <WifiOff size={14} className={styles.stateIconOffline} />;
      case 'unauthorized':
        return <AlertTriangle size={14} className={styles.stateIconWarning} />;
      default:
        return null;
    }
  };

  const getStateLabel = (state: string) => {
    switch (state) {
      case 'device':
        return 'Connected';
      case 'offline':
        return 'Offline';
      case 'unauthorized':
        return 'Unauthorized - Check device screen';
      default:
        return state;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Smartphone size={20} />
        <span>Devices</span>
        <button 
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={loading}
          title="Refresh devices"
        >
          <RefreshCw size={16} className={loading ? styles.spinning : ''} />
        </button>
      </div>

      <div className={styles.deviceList}>
        {devices.length === 0 ? (
          <div className={styles.noDevices}>
            <WifiOff size={24} />
            <p>No devices connected</p>
            <small>Connect via USB and enable USB debugging</small>
          </div>
        ) : (
          devices.map((device) => (
            <div
              key={device.id}
              className={`${styles.deviceItem} ${
                selectedDevice?.id === device.id ? styles.selected : ''
              } ${device.state !== 'device' ? styles.unavailable : ''}`}
              onClick={() => device.state === 'device' && onSelect(device)}
              role="button"
              tabIndex={device.state === 'device' ? 0 : -1}
            >
              <div className={styles.deviceInfo}>
                <span className={styles.deviceModel}>
                  {device.model || device.id}
                </span>
                <span className={styles.deviceId}>{device.id}</span>
              </div>
              <div className={styles.deviceActions}>
                <div className={styles.deviceState}>
                  {getStateIcon(device.state)}
                  <span>{getStateLabel(device.state)}</span>
                </div>
                {isWirelessDevice(device) && device.state === 'device' && (
                  <button
                    className={styles.disconnectBtn}
                    onClick={(e) => handleDisconnect(device, e)}
                    disabled={disconnecting === device.id}
                    title="Disconnect wireless device"
                  >
                    {disconnecting === device.id
                      ? <Loader size={13} className={styles.spinning} />
                      : <Unplug size={13} />}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
