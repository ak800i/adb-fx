import type { Device } from '../types';
import { 
  Smartphone, 
  RefreshCw, 
  WifiOff, 
  AlertTriangle,
  Check 
} from 'lucide-react';
import styles from './DeviceSelector.module.css';

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
            <button
              key={device.id}
              className={`${styles.deviceItem} ${
                selectedDevice?.id === device.id ? styles.selected : ''
              } ${device.state !== 'device' ? styles.unavailable : ''}`}
              onClick={() => device.state === 'device' && onSelect(device)}
              disabled={device.state !== 'device'}
            >
              <div className={styles.deviceInfo}>
                <span className={styles.deviceModel}>
                  {device.model || device.id}
                </span>
                <span className={styles.deviceId}>{device.id}</span>
              </div>
              <div className={styles.deviceState}>
                {getStateIcon(device.state)}
                <span>{getStateLabel(device.state)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
