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
  usb?: string | null;
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
  total: number;
  offset: number;
  has_more: boolean;
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

export interface ConnectionInfo {
  transport: 'usb' | 'wifi';
  usb_path: string | null;
  usb_speed: string | null;
  usb_speed_label: string | null;
  usb_speed_bps: number | null;
  usb_max_speed: string | null;
  usb_max_speed_label: string | null;
  usb_controller: string | null;
  usb_functions: string | null;
  usb_voltage_mv: number | null;
  usb_current_ma: number | null;
  power_source: string | null;
  battery_level: number | null;
  battery_status: string | null;
  battery_temp_c: number | null;
  manufacturer: string | null;
  model: string | null;
  android_version: string | null;
  sdk: number | null;
  adb_version: string | null;
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
