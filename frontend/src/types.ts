/**
 * Type definitions for the ADB File Explorer API
 */

export type FileType = 'file' | 'directory' | 'link' | 'unknown';

export type DeviceState = 'device' | 'offline' | 'unauthorized' | 'no permissions' | 'unknown';

export interface Device {
  id: string;
  model: string | null;
  state: DeviceState;
  product: string | null;
  transport_id: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: FileType;
  size: number | null;
  permissions: string | null;
  owner: string | null;
  group: string | null;
  modified: string | null;
  link_target: string | null;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
  parent: string | null;
}

export interface OperationResult {
  success: boolean;
  message: string;
  path: string | null;
}

export interface DeviceStorageInfo {
  total: number;
  used: number;
  available: number;
  mount_point: string;
}

// Local filesystem types
export interface LocalEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number | null;
}

export interface LocalListResponse {
  path: string;
  parent: string | null;
  entries: LocalEntry[];
}
