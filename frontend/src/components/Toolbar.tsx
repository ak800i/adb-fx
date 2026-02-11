import React from 'react';
import { 
  ChevronUp, 
  RefreshCw, 
  Home,
  FolderPlus,
  Upload,
  Download,
  Trash2
} from 'lucide-react';
import styles from './Toolbar.module.css';

interface ToolbarProps {
  currentPath: string;
  canGoUp: boolean;
  hasSelection: boolean;
  selectionCount: number;
  onGoUp: () => void;
  onGoHome: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onPathChange: (path: string) => void;
}

export function Toolbar({
  currentPath,
  canGoUp,
  hasSelection,
  selectionCount,
  onGoUp,
  onGoHome,
  onRefresh,
  onNewFolder,
  onUpload,
  onDownload,
  onDelete,
  onPathChange,
}: ToolbarProps) {
  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onPathChange(e.currentTarget.value);
    }
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.navigation}>
        <button
          onClick={onGoUp}
          disabled={!canGoUp}
          title="Go to parent folder"
        >
          <ChevronUp size={18} />
        </button>
        <button onClick={onGoHome} title="Go to /sdcard">
          <Home size={18} />
        </button>
        <button onClick={onRefresh} title="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className={styles.pathBar}>
        <input
          type="text"
          defaultValue={currentPath}
          key={currentPath}
          onKeyDown={handlePathKeyDown}
          onBlur={(e) => {
            if (e.target.value !== currentPath) {
              onPathChange(e.target.value);
            }
          }}
        />
      </div>

      <div className={styles.actions}>
        <button onClick={onNewFolder} title="New folder">
          <FolderPlus size={18} />
          <span className={styles.btnText}>New Folder</span>
        </button>
        <button onClick={onUpload} title="Upload files">
          <Upload size={18} />
          <span className={styles.btnText}>Upload</span>
        </button>
        <button
          onClick={onDownload}
          disabled={!hasSelection}
          title={hasSelection ? `Download ${selectionCount} item(s)` : 'Select files to download'}
        >
          <Download size={18} />
          <span className={styles.btnText}>Download</span>
        </button>
        <button
          className="danger"
          onClick={onDelete}
          disabled={!hasSelection}
          title={hasSelection ? `Delete ${selectionCount} item(s)` : 'Select files to delete'}
        >
          <Trash2 size={18} />
          <span className={styles.btnText}>Delete</span>
        </button>
      </div>
    </div>
  );
}
