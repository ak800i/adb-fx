/**
 * API service for communicating with the ADB backend
 */

import type { 
  Device, 
  FileListResponse, 
  OperationResult,
  DeviceStorageInfo,
  LocalListResponse,
} from '../types';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data.detail || data.message || message;
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(response.status, message);
  }
  return response.json();
}

/**
 * Device-related API calls
 */
export const deviceApi = {
  /**
   * Get list of connected devices
   */
  async getDevices(): Promise<Device[]> {
    const response = await fetch(`${API_BASE}/devices`);
    return handleResponse<Device[]>(response);
  },

  /**
   * Get storage info for a device
   */
  async getStorageInfo(deviceId: string): Promise<DeviceStorageInfo[]> {
    const response = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/storage`);
    return handleResponse<DeviceStorageInfo[]>(response);
  },

  /**
   * Connect to a device wirelessly over TCP/IP
   */
  async wirelessConnect(address: string, port: number = 5555): Promise<OperationResult> {
    const response = await fetch(`${API_BASE}/devices/wireless/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, port }),
    });
    return handleResponse<OperationResult>(response);
  },

  /**
   * Disconnect a wireless device
   */
  async wirelessDisconnect(address: string, port: number = 5555): Promise<OperationResult> {
    const response = await fetch(`${API_BASE}/devices/wireless/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, port }),
    });
    return handleResponse<OperationResult>(response);
  },

  /**
   * Pair with a device using Android 11+ wireless debugging pairing code
   */
  async wirelessPair(address: string, port: number, code: string): Promise<OperationResult> {
    const response = await fetch(`${API_BASE}/devices/wireless/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, port, code }),
    });
    return handleResponse<OperationResult>(response);
  },

  /**
   * Switch a USB-connected device to TCP/IP mode
   */
  async wirelessTcpip(deviceId: string, port: number = 5555): Promise<OperationResult> {
    const response = await fetch(`${API_BASE}/devices/wireless/tcpip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, port }),
    });
    return handleResponse<OperationResult>(response);
  },
};

/**
 * File-related API calls
 */
export const fileApi = {
  /**
   * List files in a directory
   */
  async listFiles(deviceId: string, path: string = '/storage', offset = 0, limit = 1000): Promise<FileListResponse> {
    const params = new URLSearchParams({ path, offset: String(offset), limit: String(limit) });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files?${params}`
    );
    return handleResponse<FileListResponse>(response);
  },

  /**
   * Push a local file/folder directly to the device (no HTTP file transfer)
   */
  async pushLocal(
    deviceId: string,
    localPath: string,
    remotePath: string,
    transferId?: string,
  ): Promise<OperationResult> {
    const params = new URLSearchParams({ local_path: localPath, remote_path: remotePath });
    if (transferId) params.set('transfer_id', transferId);
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/push?${params}`,
      { method: 'POST' }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Pull a device file directly to a local directory (no HTTP file transfer)
   */
  async pullToLocal(
    deviceId: string,
    remotePath: string,
    localDir: string,
    transferId?: string,
  ): Promise<OperationResult> {
    const params = new URLSearchParams({ remote_path: remotePath, local_dir: localDir });
    if (transferId) params.set('transfer_id', transferId);
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/pull?${params}`,
      { method: 'POST' }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Cancel an in-progress transfer
   */
  async cancelTransfer(deviceId: string, transferId: string): Promise<void> {
    const params = new URLSearchParams({ transfer_id: transferId });
    await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/cancel?${params}`,
      { method: 'POST' }
    );
  },

  /**
   * Get progress info for an in-progress transfer
   */
  async getProgress(deviceId: string, transferId: string): Promise<{ progress: number; speedBps: number } | null> {
    const params = new URLSearchParams({ transfer_id: transferId });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/progress?${params}`
    );
    const data = await response.json();
    if (data.progress == null) return null;
    return { progress: data.progress, speedBps: data.speed_bps ?? 0 };
  },

  /**
   * Create a directory on the device
   */
  async createDirectory(deviceId: string, path: string): Promise<OperationResult> {
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/mkdir`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Delete a file or directory
   */
  async deleteFile(
    deviceId: string, 
    path: string, 
    recursive: boolean = false
  ): Promise<OperationResult> {
    const params = new URLSearchParams({ 
      path, 
      recursive: recursive.toString() 
    });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files?${params}`,
      { method: 'DELETE' }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Delete multiple files or directories in one operation
   */
  async bulkDelete(
    deviceId: string,
    paths: string[],
    transferId?: string,
  ): Promise<OperationResult> {
    const params = new URLSearchParams();
    if (transferId) params.set('transfer_id', transferId);
    const qs = params.toString();
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/bulk-delete${qs ? `?${qs}` : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Pull multiple files from device in a single operation
   */
  async bulkPull(
    deviceId: string,
    paths: string[],
    localDir: string,
    transferId?: string,
  ): Promise<OperationResult> {
    const params = new URLSearchParams();
    if (transferId) params.set('transfer_id', transferId);
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/bulk-pull?${params}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, local_dir: localDir }),
      }
    );
    return handleResponse<OperationResult>(response);
  },

  /**
   * Rename/move a file or directory
   */
  async renameFile(
    deviceId: string, 
    oldPath: string, 
    newPath: string
  ): Promise<OperationResult> {
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/rename`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
      }
    );
    return handleResponse<OperationResult>(response);
  },
};

/**
 * Local filesystem API calls (for direct push/pull without HTTP file transfer)
 */
export const localApi = {
  /**
   * List available drives (Windows)
   */
  async getDrives(): Promise<string[]> {
    const response = await fetch(`${API_BASE}/local/drives`);
    return handleResponse<string[]>(response);
  },

  /**
   * List contents of a local directory
   */
  async listDirectory(path: string): Promise<LocalListResponse> {
    const params = new URLSearchParams({ path });
    const response = await fetch(`${API_BASE}/local/list?${params}`);
    return handleResponse<LocalListResponse>(response);
  },

  /**
   * Open native OS folder picker dialog
   */
  async pickFolder(initialDir?: string, title?: string): Promise<string | null> {
    const params = new URLSearchParams();
    if (initialDir) params.set('initial_dir', initialDir);
    if (title) params.set('title', title);
    const response = await fetch(`${API_BASE}/local/pick-folder?${params}`);
    const data = await response.json();
    return data.path ?? null;
  },

  /**
   * Open native OS file picker dialog (multi-select)
   */
  async pickFiles(initialDir?: string, title?: string): Promise<string[]> {
    const params = new URLSearchParams();
    if (initialDir) params.set('initial_dir', initialDir);
    if (title) params.set('title', title);
    const response = await fetch(`${API_BASE}/local/pick-files?${params}`);
    const data = await response.json();
    return data.paths ?? [];
  },
};
