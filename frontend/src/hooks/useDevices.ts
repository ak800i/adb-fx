import { useState, useEffect, useCallback } from 'react';
import type { Device } from '../types';
import { deviceApi } from '../services/api';

/**
 * Hook for managing connected Android devices
 */
export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const deviceList = await deviceApi.getDevices();
      setDevices(deviceList);

      // Auto-select first connected device
      if (!selectedDevice && deviceList.length > 0) {
        const connected = deviceList.find(d => d.state === 'device');
        if (connected) {
          setSelectedDevice(connected);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    refreshDevices();
    // Poll for device changes every 5 seconds
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, [refreshDevices]);

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    loading,
    error,
    refreshDevices,
  };
}
