/**
 * API service for communicating with the ADB backend
 */

import type { 
  Device, 
  FileListResponse, 
  OperationResult,
  DeviceStorageInfo 
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
};

/**
 * File-related API calls
 */
export const fileApi = {
  /**
   * List files in a directory
   */
  async listFiles(deviceId: string, path: string = '/sdcard'): Promise<FileListResponse> {
    const params = new URLSearchParams({ path });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files?${params}`
    );
    return handleResponse<FileListResponse>(response);
  },

  /**
   * Download a file from the device
   */
  async downloadFile(deviceId: string, path: string): Promise<Blob> {
    const params = new URLSearchParams({ path });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/download?${params}`
    );
    
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data.detail || data.message || message;
      } catch {
        // Response might not be JSON
      }
      throw new ApiError(response.status, message);
    }
    
    return response.blob();
  },

  /**
   * Upload a file to the device
   */
  async uploadFile(
    deviceId: string, 
    file: File, 
    destinationPath: string
  ): Promise<OperationResult> {
    const formData = new FormData();
    formData.append('file', file);
    
    const params = new URLSearchParams({ path: destinationPath });
    const response = await fetch(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/files/upload?${params}`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return handleResponse<OperationResult>(response);
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
