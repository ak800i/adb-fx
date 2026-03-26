import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileEntry } from '../types';
import { fileApi } from '../services/api';

const DEFAULT_PATH = '/storage';

function getPathFromHash(): string {
  const hash = window.location.hash.slice(1); // remove '#'
  if (!hash) return DEFAULT_PATH;
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function setHashPath(path: string) {
  // Encode each segment individually so '/' stays readable but spaces/special chars are encoded
  const newHash = '#' + path.split('/').map(s => encodeURIComponent(s)).join('/');
  if (window.location.hash !== newHash) {
    window.history.pushState(null, '', newHash);
  }
}

const PAGE_LIMIT = 1000;

/**
 * Hook for managing file browser state and operations
 */
export function useFileBrowser(deviceId: string | null) {
  const [currentPath, setCurrentPath] = useState(getPathFromHash);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
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
      
      // Fetch first page
      const first = await fileApi.listFiles(deviceId, path, 0, PAGE_LIMIT);
      setCurrentPath(first.path);
      setHashPath(first.path);
      setParentPath(first.parent);
      setTotalFiles(first.total);

      let allEntries = first.entries;

      // Fetch remaining pages if needed
      if (first.has_more) {
        let offset = PAGE_LIMIT;
        while (offset < first.total) {
          const page = await fileApi.listFiles(deviceId, path, offset, PAGE_LIMIT);
          allEntries = allEntries.concat(page.entries);
          offset += PAGE_LIMIT;
        }
      }

      setFiles(allEntries);
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

  const selectRange = useCallback((paths: string[]) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      for (const p of paths) {
        next.add(p);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.path)));
  }, [files]);

  return {
    currentPath,
    files,
    totalFiles,
    parentPath,
    loading,
    error,
    selectedFiles,
    navigateTo,
    refresh,
    goUp,
    toggleSelection,
    selectRange,
    clearSelection,
    selectAll,
  };
}
