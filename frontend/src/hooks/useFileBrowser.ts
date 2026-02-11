import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry, FileListResponse } from '../types';
import { fileApi } from '../services/api';

const DEFAULT_PATH = '/sdcard';

function getPathFromHash(): string {
  const hash = window.location.hash.slice(1); // remove '#'
  return hash || DEFAULT_PATH;
}

function setHashPath(path: string) {
  const newHash = '#' + path;
  if (window.location.hash !== newHash) {
    window.history.pushState(null, '', newHash);
  }
}

/**
 * Hook for managing file browser state and operations
 */
export function useFileBrowser(deviceId: string | null) {
  const [currentPath, setCurrentPath] = useState(getPathFromHash);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const isNavigating = useRef(false);

  const navigateTo = useCallback(async (path: string) => {
    if (!deviceId) return;

    try {
      isNavigating.current = true;
      setLoading(true);
      setError(null);
      setSelectedFiles(new Set());
      
      const response: FileListResponse = await fileApi.listFiles(deviceId, path);
      setCurrentPath(response.path);
      setHashPath(response.path);
      setFiles(response.entries);
      setParentPath(response.parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    } finally {
      setLoading(false);
      isNavigating.current = false;
    }
  }, [deviceId]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      if (!isNavigating.current) {
        const path = getPathFromHash();
        navigateTo(path);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigateTo]);

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
