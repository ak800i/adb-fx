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

interface FileListProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  onFileClick: (file: FileEntry) => void;
  onFileDoubleClick: (file: FileEntry) => void;
  onToggleSelect: (path: string) => void;
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

export function FileList({
  files,
  selectedFiles,
  onFileClick,
  onFileDoubleClick,
  onToggleSelect,
  loading,
}: FileListProps) {
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.colCheck}></span>
        <span className={styles.colName}>Name</span>
        <span className={styles.colSize}>Size</span>
        <span className={styles.colDate}>Modified</span>
        <span className={styles.colPerms}>Permissions</span>
      </div>
      
      <div className={styles.list}>
        {files.map((file) => (
          <div
            key={file.path}
            className={`${styles.row} ${
              selectedFiles.has(file.path) ? styles.selected : ''
            }`}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                onToggleSelect(file.path);
              } else {
                onFileClick(file);
              }
            }}
            onDoubleClick={() => onFileDoubleClick(file)}
          >
            <span className={styles.colCheck}>
              <input
                type="checkbox"
                checked={selectedFiles.has(file.path)}
                onChange={() => onToggleSelect(file.path)}
                onClick={(e) => e.stopPropagation()}
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
        ))}
      </div>
    </div>
  );
}
