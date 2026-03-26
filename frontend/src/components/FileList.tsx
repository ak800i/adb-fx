import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { FileEntry } from '../types';
import { 
  Folder, 
  File, 
  FileText, 
  Image, 
  Music, 
  Video,
  Archive,
  Code,
  Link,
  FileQuestion,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import styles from './FileList.module.css';

const ROW_HEIGHT = 40;

type SortField = 'name' | 'type' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

interface FileListProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry) => void;
  onFileDoubleClick: (file: FileEntry) => void;
  onToggleSelect: (path: string) => void;
  onSelectRange: (paths: string[]) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  loading: boolean;
}

function getFileIcon(file: FileEntry) {
  if (file.type === 'directory') {
    return <Folder size={20} className={styles.iconFolder} />;
  }
  
  if (file.type === 'link') {
    return <Link size={20} className={styles.iconLink} />;
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  
  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)) {
    return <Image size={20} className={styles.iconImage} />;
  }
  
  // Videos
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', '3gp'].includes(ext)) {
    return <Video size={20} className={styles.iconVideo} />;
  }
  
  // Audio
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'].includes(ext)) {
    return <Music size={20} className={styles.iconAudio} />;
  }
  
  // Archives
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'apk'].includes(ext)) {
    return <Archive size={20} className={styles.iconArchive} />;
  }
  
  // Code
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'kt', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sh', 'bat'].includes(ext)) {
    return <Code size={20} className={styles.iconCode} />;
  }
  
  // Text
  if (['txt', 'md', 'log', 'ini', 'cfg', 'conf'].includes(ext)) {
    return <FileText size={20} className={styles.iconText} />;
  }
  
  return <File size={20} className={styles.iconFile} />;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '-';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

interface RowData {
  files: FileEntry[];
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry) => void;
  onFileDoubleClick: (file: FileEntry) => void;
  onRowClick: (index: number, shiftKey: boolean, ctrlKey: boolean) => void;
}

type FileRowProps = RowComponentProps<RowData>;

function Row({ index, style, files, selectedFiles, onFileDoubleClick, onRowClick }: FileRowProps) {
  const file = files[index];

  return (
    <div
      style={style}
      className={`${styles.row} ${
        selectedFiles.has(file.path) ? styles.selected : ''
      }`}
      onClick={(e) => {
        onRowClick(index, e.shiftKey, e.ctrlKey || e.metaKey);
      }}
      onDoubleClick={() => onFileDoubleClick(file)}
    >
      <span className={styles.colCheck}>
        <input
          type="checkbox"
          checked={selectedFiles.has(file.path)}
          readOnly
          tabIndex={-1}
        />
      </span>
      <span className={styles.colName}>
        {getFileIcon(file)}
        <span className={styles.fileName}>
          {file.name}
          {file.link_target && (
            <span className={styles.linkTarget}> → {file.link_target}</span>
          )}
        </span>
      </span>
      <span className={styles.colSize}>
        {file.type === 'file' ? formatSize(file.size) : '-'}
      </span>
      <span className={styles.colDate}>
        {formatDate(file.modified)}
      </span>
      <span className={styles.colType}>
        {file.type === 'directory' ? 'Folder' : getExtension(file.name).toUpperCase() || '-'}
      </span>
    </div>
  );
}

export function FileList({
  files,
  selectedFiles,
  onFileClick,
  onFileDoubleClick,
  onToggleSelect,
  onSelectRange,
  onSelectAll,
  onClearSelection,
  loading,
}: FileListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);
  const anchorPath = useRef<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const sortedFiles = useMemo(() => {
    const sorted = [...files];
    sorted.sort((a, b) => {
      // Directories always first
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;

      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'type': {
          const extA = getExtension(a.name);
          const extB = getExtension(b.name);
          cmp = extA.localeCompare(extB) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        }
        case 'size':
          cmp = (a.size ?? 0) - (b.size ?? 0);
          break;
        case 'modified': {
          const tA = a.modified ? new Date(a.modified).getTime() : 0;
          const tB = b.modified ? new Date(b.modified).getTime() : 0;
          cmp = tA - tB;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [files, sortField, sortDir]);

  const toggleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      } else {
        setSortDir('asc');
      }
      return field;
    });
  }, []);

  const handleRowClick = useCallback((index: number, shiftKey: boolean, ctrlKey: boolean) => {
    const file = sortedFiles[index];
    if (shiftKey && anchorPath.current !== null) {
      const anchorIdx = sortedFiles.findIndex(f => f.path === anchorPath.current);
      if (anchorIdx !== -1) {
        const start = Math.min(anchorIdx, index);
        const end = Math.max(anchorIdx, index);
        const paths = sortedFiles.slice(start, end + 1).map(f => f.path);
        onSelectRange(paths);
      }
    } else if (ctrlKey) {
      onToggleSelect(file.path);
      anchorPath.current = file.path;
    } else if (selectedFiles.size > 0) {
      onToggleSelect(file.path);
      anchorPath.current = file.path;
    } else {
      onFileClick(file);
      anchorPath.current = file.path;
    }
  }, [sortedFiles, selectedFiles.size, onFileClick, onToggleSelect, onSelectRange]);

  const updateHeight = useCallback(() => {
    if (containerRef.current) {
      const headerEl = containerRef.current.querySelector(`.${styles.header}`);
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const containerH = containerRef.current.getBoundingClientRect().height;
      setListHeight(Math.max(containerH - headerH, 100));
    }
  }, []);

  useEffect(() => {
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateHeight]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <span>Loading files...</span>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={styles.empty}>
        <FileQuestion size={48} />
        <p>This folder is empty</p>
      </div>
    );
  }

  const rowProps: RowData = {
    files: sortedFiles,
    selectedFiles,
    onFileClick,
    onFileDoubleClick,
    onRowClick: handleRowClick,
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp size={14} className={styles.sortIcon} />
      : <ChevronDown size={14} className={styles.sortIcon} />;
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <span className={styles.colCheck}>
          <input
            type="checkbox"
            checked={files.length > 0 && selectedFiles.size === files.length}
            ref={(el) => { if (el) el.indeterminate = selectedFiles.size > 0 && selectedFiles.size < files.length; }}
            onChange={() => selectedFiles.size === files.length ? onClearSelection() : onSelectAll()}
          />
        </span>
        <span className={`${styles.colName} ${styles.sortable}`} onClick={() => toggleSort('name')}>
          Name {sortIndicator('name')}
        </span>
        <span className={`${styles.colSize} ${styles.sortable}`} onClick={() => toggleSort('size')}>
          Size {sortIndicator('size')}
        </span>
        <span className={`${styles.colDate} ${styles.sortable}`} onClick={() => toggleSort('modified')}>
          Modified {sortIndicator('modified')}
        </span>
        <span className={`${styles.colType} ${styles.sortable}`} onClick={() => toggleSort('type')}>
          Type {sortIndicator('type')}
        </span>
      </div>
      
      <List
        rowCount={sortedFiles.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={Row}
        rowProps={rowProps}
        overscanCount={20}
        style={{ height: listHeight }}
      />
    </div>
  );
}
