import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useDevices } from './hooks/useDevices';
import { useFileBrowser } from './hooks/useFileBrowser';
import { DeviceSelector } from './components/DeviceSelector';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { InputModal, ConfirmModal } from './components/Modal';
import { Toast, ToastMessage } from './components/Toast';
import { fileApi } from './services/api';
import type { FileEntry } from './types';
import { Upload } from 'lucide-react';
import styles from './App.module.css';

function App() {
  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    loading: devicesLoading,
    refreshDevices,
  } = useDevices();

  const {
    currentPath,
    files,
    parentPath,
    loading: filesLoading,
    selectedFiles,
    navigateTo,
    refresh,
    goUp,
    toggleSelection,
    clearSelection,
  } = useFileBrowser(selectedDevice?.id ?? null);

  // Modals state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  
  // File upload input refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Load files when device changes
  useEffect(() => {
    if (selectedDevice?.state === 'device') {
      navigateTo('/sdcard');
    }
  }, [selectedDevice, navigateTo]);

  // Toast helpers
  const addToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // File operations
  const handleFileClick = useCallback((file: FileEntry) => {
    clearSelection();
    toggleSelection(file.path);
  }, [clearSelection, toggleSelection]);

  const handleFileDoubleClick = useCallback((file: FileEntry) => {
    if (file.type === 'directory') {
      navigateTo(file.path);
    }
  }, [navigateTo]);

  const handleNewFolder = useCallback(async (name: string) => {
    if (!selectedDevice) return;
    
    try {
      const path = `${currentPath}/${name}`.replace(/\/+/g, '/');
      await fileApi.createDirectory(selectedDevice.id, path);
      addToast('success', `Created folder: ${name}`);
      refresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to create folder');
    }
    setShowNewFolder(false);
  }, [selectedDevice, currentPath, addToast, refresh]);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleUploadFolder = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const updateToastProgress = useCallback((id: string, progress: number, message?: string) => {
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, progress, ...(message ? { message } : {}) }
          : t
      )
    );
  }, []);

  const formatSize = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const uploadSingleFile = useCallback(async (
    file: File,
    destPath: string,
    displayName: string,
  ) => {
    const toastId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setToasts((prev) => [
      ...prev,
      { id: toastId, type: 'info', message: `Uploading: ${displayName} (0%)`, progress: 0 },
    ]);

    try {
      await fileApi.uploadFile(selectedDevice!.id, file, destPath, (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        updateToastProgress(
          toastId,
          pct,
          `Uploading: ${displayName} \u2014 ${formatSize(loaded)} / ${formatSize(total)} (${pct}%)`
        );
      });

      setToasts((prev) =>
        prev.map((t) =>
          t.id === toastId
            ? { ...t, type: 'success' as const, message: `Uploaded: ${displayName}`, progress: undefined }
            : t
        )
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 4000);
    } catch (err) {
      setToasts((prev) =>
        prev.map((t) =>
          t.id === toastId
            ? { ...t, type: 'error' as const, message: `Failed: ${displayName}: ${err instanceof Error ? err.message : 'Unknown error'}`, progress: undefined }
            : t
        )
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 6000);
    }
  }, [selectedDevice, updateToastProgress, formatSize]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedDevice) return;

    const isFolder = !!(files[0] as any).webkitRelativePath;

    for (const file of Array.from(files)) {
      let destPath = currentPath;
      let displayName = file.name;
      const relativePath = (file as any).webkitRelativePath as string;

      if (isFolder && relativePath) {
        const relativeDir = relativePath.substring(0, relativePath.lastIndexOf('/'));
        destPath = `${currentPath}/${relativeDir}`.replace(/\/+/g, '/');
        displayName = relativePath;
      }

      if (isFolder && destPath !== currentPath) {
        try {
          await fileApi.createDirectory(selectedDevice.id, destPath);
        } catch { /* directory may already exist */ }
      }

      await uploadSingleFile(file, destPath, displayName);
    }

    e.target.value = '';
    refresh();
  }, [selectedDevice, currentPath, uploadSingleFile, refresh]);

  const handleDownload = useCallback(async () => {
    if (!selectedDevice || selectedFiles.size === 0) return;

    for (const path of selectedFiles) {
      const file = files.find((f) => f.path === path);
      if (!file || file.type === 'directory') {
        addToast('error', `Cannot download directory: ${file?.name || path}`);
        continue;
      }

      try {
        const blob = await fileApi.downloadFile(selectedDevice.id, path);
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        addToast('success', `Downloaded: ${file.name}`);
      } catch (err) {
        addToast('error', `Failed to download ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    clearSelection();
  }, [selectedDevice, selectedFiles, files, addToast, clearSelection]);

  const handleDelete = useCallback(async () => {
    if (!selectedDevice || selectedFiles.size === 0) return;

    for (const path of selectedFiles) {
      try {
        await fileApi.deleteFile(selectedDevice.id, path, true);
        addToast('success', `Deleted: ${path.split('/').pop()}`);
      } catch (err) {
        addToast('error', `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    setShowDeleteConfirm(false);
    clearSelection();
    refresh();
  }, [selectedDevice, selectedFiles, addToast, clearSelection, refresh]);

  const handleGoHome = useCallback(() => {
    navigateTo('/sdcard');
  }, [navigateTo]);

  // --- Drag and drop ---
  const readEntryAsFile = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

  const readDirectoryEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  const collectFiles = async (
    entry: FileSystemEntry,
    basePath: string,
  ): Promise<{ file: File; relativePath: string }[]> => {
    if (entry.isFile) {
      const file = await readEntryAsFile(entry as FileSystemFileEntry);
      return [{ file, relativePath: basePath ? `${basePath}/${entry.name}` : entry.name }];
    }
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const results: { file: File; relativePath: string }[] = [];
    const subPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    let entries: FileSystemEntry[];
    do {
      entries = await readDirectoryEntries(reader);
      for (const child of entries) {
        results.push(...(await collectFiles(child, subPath)));
      }
    } while (entries.length > 0);
    return results;
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);

    if (!selectedDevice) return;

    const items = e.dataTransfer.items;
    const allFiles: { file: File; relativePath: string }[] = [];

    // Use webkitGetAsEntry to support folders
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    for (const entry of entries) {
      allFiles.push(...(await collectFiles(entry, '')));
    }

    // Upload all collected files
    for (const { file, relativePath } of allFiles) {
      const relativeDir = relativePath.includes('/')
        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
        : '';
      const destPath = relativeDir
        ? `${currentPath}/${relativeDir}`.replace(/\/+/g, '/')
        : currentPath;

      if (relativeDir) {
        try {
          await fileApi.createDirectory(selectedDevice.id, destPath);
        } catch { /* directory may already exist */ }
      }

      await uploadSingleFile(file, destPath, relativePath);
    }

    refresh();
  }, [selectedDevice, currentPath, uploadSingleFile, refresh]);

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <img src="/icon.svg" alt="ADB-FX" width={32} height={32} />
          <h1>ADB File Explorer</h1>
        </div>
      </header>

      {/* Main content */}
      <div className={styles.main}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <DeviceSelector
            devices={devices}
            selectedDevice={selectedDevice}
            onSelect={setSelectedDevice}
            onRefresh={refreshDevices}
            loading={devicesLoading}
          />
        </aside>

        {/* File browser */}
        <main
          className={`${styles.content} ${isDragOver ? styles.dropActive : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className={styles.dropOverlay}>
              <Upload size={48} />
              <p>Drop files or folders to upload</p>
            </div>
          )}
          {selectedDevice?.state === 'device' ? (
            <>
              <Toolbar
                currentPath={currentPath}
                canGoUp={!!parentPath}
                hasSelection={selectedFiles.size > 0}
                selectionCount={selectedFiles.size}
                onGoUp={goUp}
                onGoHome={handleGoHome}
                onRefresh={refresh}
                onNewFolder={() => setShowNewFolder(true)}
                onUpload={handleUpload}
                onUploadFolder={handleUploadFolder}
                onDownload={handleDownload}
                onDelete={() => setShowDeleteConfirm(true)}
                onPathChange={navigateTo}
              />
              <FileList
                files={files}
                selectedFiles={selectedFiles}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onToggleSelect={toggleSelection}
                loading={filesLoading}
              />
            </>
          ) : (
            <div className={styles.noDevice}>
              <img src="/icon.svg" alt="" width={64} height={64} style={{ opacity: 0.5 }} />
              <h2>No Device Selected</h2>
              <p>Connect an Android device via USB and enable USB debugging</p>
            </div>
          )}
        </main>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        onChange={handleFileInputChange}
      />
      {/* Folder upload input */}
      <input
        type="file"
        ref={folderInputRef}
        style={{ display: 'none' }}
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        onChange={handleFileInputChange}
      />

      {/* Modals */}
      <InputModal
        isOpen={showNewFolder}
        title="New Folder"
        label="Folder name"
        placeholder="Enter folder name"
        onSubmit={handleNewFolder}
        onCancel={() => setShowNewFolder(false)}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Files"
        message={`Are you sure you want to delete ${selectedFiles.size} item(s)? This action cannot be undone.`}
        confirmText="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Toasts */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
