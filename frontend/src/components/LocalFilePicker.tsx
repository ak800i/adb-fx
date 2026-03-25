import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronUp, Folder, File, HardDrive } from 'lucide-react';
import { localApi } from '../services/api';
import type { LocalEntry } from '../types';
import styles from './LocalFilePicker.module.css';

const LAST_PATH_KEY = 'adb-fx-local-last-path';

export type PickerMode = 'files' | 'directory';

interface LocalFilePickerProps {
  isOpen: boolean;
  mode: PickerMode;
  title?: string;
  onSelect: (paths: string[]) => void;
  onCancel: () => void;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function LocalFilePicker({
  isOpen,
  mode,
  title,
  onSelect,
  onCancel,
}: LocalFilePickerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [drives, setDrives] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const result = await localApi.listDirectory(path);
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setEntries(result.entries);
      setPathInput(result.path);
      localStorage.setItem(LAST_PATH_KEY, result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load drives + initial path on open
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setError(null);

    localApi.getDrives().then(setDrives).catch(() => {});

    const saved = localStorage.getItem(LAST_PATH_KEY);
    const initialPath = saved || 'C:\\';
    navigate(initialPath);
  }, [isOpen, navigate]);

  const handleRowClick = useCallback((entry: LocalEntry) => {
    if (mode === 'directory') {
      // In directory mode, clicking a folder toggles its selection
      if (entry.type === 'directory') {
        setSelected((prev) => {
          // Single-select: toggle this folder or replace
          if (prev.has(entry.path)) {
            return new Set();
          }
          return new Set([entry.path]);
        });
      }
      return;
    }

    // In files mode, toggle selection
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  }, [mode, navigate]);

  const handleRowDoubleClick = useCallback((entry: LocalEntry) => {
    if (entry.type === 'directory') {
      navigate(entry.path);
    }
  }, [navigate]);

  const handleSelect = useCallback(() => {
    if (mode === 'directory') {
      // If specific folders are selected, use those; otherwise fall back to current directory
      if (selected.size > 0) {
        onSelect(Array.from(selected));
      } else {
        onSelect([currentPath]);
      }
    } else {
      onSelect(Array.from(selected));
    }
  }, [mode, currentPath, selected, onSelect]);

  const handlePathSubmit = useCallback(() => {
    if (pathInput.trim()) {
      navigate(pathInput.trim());
    }
  }, [pathInput, navigate]);

  const canSelect =
    mode === 'directory'
      ? !!currentPath
      : selected.size > 0;

  const footerText =
    mode === 'directory'
      ? selected.size > 0
        ? `Selected: ${Array.from(selected)[0].replace(/\\/g, '/').split('/').pop()}`
        : `Will use: ${currentPath}`
      : selected.size > 0
        ? `${selected.size} item(s) selected`
        : 'Select files or folders to push';

  if (!isOpen) return null;

  const displayTitle =
    title || (mode === 'directory' ? 'Choose Destination Folder' : 'Select Files to Upload');

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.picker} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h3>{displayTitle}</h3>
          <button className={styles.closeBtn} onClick={onCancel}>
            <X size={20} />
          </button>
        </div>

        {/* Path bar */}
        <div className={styles.pathRow}>
          <button
            onClick={() => parentPath && navigate(parentPath)}
            disabled={!parentPath}
            title="Go up"
          >
            <ChevronUp size={18} />
          </button>
          <input
            ref={pathInputRef}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit(); }}
            onBlur={handlePathSubmit}
          />
        </div>

        {/* Drives */}
        {drives.length > 0 && (
          <div className={styles.drives}>
            {drives.map((d) => (
              <button
                key={d}
                className={styles.driveBtn}
                onClick={() => navigate(d)}
                title={d}
              >
                <HardDrive size={12} /> {d.replace('\\', '')}
              </button>
            ))}
          </div>
        )}

        {/* File list */}
        <div className={styles.fileList}>
          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>Empty directory</div>
          ) : (
            entries
            .filter((entry) => mode === 'files' || entry.type === 'directory')
            .map((entry) => {
              const isDir = entry.type === 'directory';
              const isSelected = selected.has(entry.path);
              // In directory mode, files are shown but not interactive
              const isDisabled = mode === 'directory' && !isDir;
              // Show checkboxes: always in files mode, only for folders in directory mode
              const showCheckbox = mode === 'files' || (mode === 'directory' && isDir);

              return (
                <div
                  key={entry.path}
                  className={`${styles.row} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
                  onClick={() => !isDisabled && handleRowClick(entry)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                >
                  {showCheckbox && (
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => {}}
                      tabIndex={-1}
                    />
                  )}
                  <span className={styles.icon}>
                    {isDir ? (
                      <Folder size={18} className={styles.iconFolder} />
                    ) : (
                      <File size={18} className={styles.iconFile} />
                    )}
                  </span>
                  <span className={styles.name}>{entry.name}</span>
                  {!isDir && entry.size != null && (
                    <span className={styles.size}>{formatSize(entry.size)}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.footerInfo}>{footerText}</span>
          <div className={styles.footerActions}>
            <button onClick={onCancel}>Cancel</button>
            <button
              className={styles.selectBtn}
              onClick={handleSelect}
              disabled={!canSelect}
            >
              {mode === 'directory'
                ? selected.size > 0
                  ? 'Select'
                  : 'Select Folder'
                : `Select (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
