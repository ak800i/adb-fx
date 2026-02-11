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
  
  // File upload input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedDevice) return;

    for (const file of Array.from(files)) {
      try {
        await fileApi.uploadFile(selectedDevice.id, file, currentPath);
        addToast('success', `Uploaded: ${file.name}`);
      } catch (err) {
        addToast('error', `Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    // Reset input and refresh
    e.target.value = '';
    refresh();
  }, [selectedDevice, currentPath, addToast, refresh]);

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
        <main className={styles.content}>
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

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
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
