import { useRef, useEffect, useState, useCallback } from 'react';
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
  FileQuestion
} from 'lucide-react';
import styles from './FileList.module.css';

const ROW_HEIGHT = 40;

interface FileListProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry) => void;
  onFileDoubleClick: (file: FileEntry) => void;
  onToggleSelect: (path: string) => void;
  onSelectRange: (fromIndex: number, toIndex: number) => void;
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
      <span className={styles.colPerms}>
        {file.permissions || '-'}
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
  loading,
}: FileListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);
  const anchorIndex = useRef<number | null>(null);

  const handleRowClick = useCallback((index: number, shiftKey: boolean, ctrlKey: boolean) => {
    const file = files[index];
    if (shiftKey && anchorIndex.current !== null) {
      onSelectRange(anchorIndex.current, index);
    } else if (ctrlKey) {
      onToggleSelect(file.path);
      anchorIndex.current = index;
    } else if (selectedFiles.size > 0) {
      onToggleSelect(file.path);
      anchorIndex.current = index;
    } else {
      onFileClick(file);
      anchorIndex.current = index;
    }
  }, [files, selectedFiles.size, onFileClick, onToggleSelect, onSelectRange]);

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
    files,
    selectedFiles,
    onFileClick,
    onFileDoubleClick,
    onRowClick: handleRowClick,
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <span className={styles.colCheck}></span>
        <span className={styles.colName}>Name</span>
        <span className={styles.colSize}>Size</span>
        <span className={styles.colDate}>Modified</span>
        <span className={styles.colPerms}>Permissions</span>
      </div>
      
      <List
        rowCount={files.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={Row}
        rowProps={rowProps}
        overscanCount={20}
        style={{ height: listHeight }}
      />
    </div>
  );
}
