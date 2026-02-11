import { useState, useCallback } from 'react';
import type { FileEntry, FileListResponse } from '../types';
import { fileApi } from '../services/api';

/**
 * Hook for managing file browser state and operations
 */
export function useFileBrowser(deviceId: string | null) {
  const [currentPath, setCurrentPath] = useState('/sdcard');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const navigateTo = useCallback(async (path: string) => {
    if (!deviceId) return;

    try {
      setLoading(true);
      setError(null);
      setSelectedFiles(new Set());
      
      const response: FileListResponse = await fileApi.listFiles(deviceId, path);
      setCurrentPath(response.path);
      setFiles(response.entries);
      setParentPath(response.parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  const refresh = useCallback(() => {
    navigateTo(currentPath);
  }, [currentPath, navigateTo]);

  const goUp = useCallback(() => {
    if (parentPath) {
      navigateTo(parentPath);
    }
  }, [parentPath, navigateTo]);

  const toggleSelection = useCallback((path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.path)));
  }, [files]);

  return {
    currentPath,
    files,
    parentPath,
    loading,
    error,
    selectedFiles,
    navigateTo,
    refresh,
    goUp,
    toggleSelection,
    clearSelection,
    selectAll,
  };
}
