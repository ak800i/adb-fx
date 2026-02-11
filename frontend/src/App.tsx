import { useEffect, useCallback, useState } from 'react';
import { useDevices } from './hooks/useDevices';
import { useFileBrowser } from './hooks/useFileBrowser';
import { DeviceSelector } from './components/DeviceSelector';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { InputModal, ConfirmModal } from './components/Modal';
import { LocalFilePicker, PickerMode } from './components/LocalFilePicker';
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

  // Local file picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('files');
  const [pickerTitle, setPickerTitle] = useState<string | undefined>();
  const [pickerAction, setPickerAction] = useState<'upload' | 'download'>('upload');

  // Load files when device changes
  useEffect(() => {
    if (selectedDevice?.state === 'device') {
      navigateTo(currentPath || '/sdcard');
    }
  }, [selectedDevice]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPickerMode('files');
    setPickerTitle('Select Files to Upload');
    setPickerAction('upload');
    setPickerOpen(true);
  }, []);

  const handleUploadFolder = useCallback(() => {
    setPickerMode('directory');
    setPickerTitle('Select Folder to Upload');
    setPickerAction('upload');
    setPickerOpen(true);
  }, []);

  const handlePickerSelect = useCallback(async (paths: string[]) => {
    setPickerOpen(false);
    if (!selectedDevice || paths.length === 0) return;

    const cancelTransfer = (deviceId: string, transferId: string, toastId: string) => {
      fileApi.cancelTransfer(deviceId, transferId).catch(() => {});
      setToasts((prev) =>
        prev.map((t) =>
          t.id === toastId
            ? { ...t, type: 'info' as const, message: `Cancelling...`, onCancel: undefined, progress: undefined }
            : t
        )
      );
    };

    // Start polling progress for a transfer, returns cleanup function
    const startProgressPoll = (deviceId: string, transferId: string, toastId: string) => {
      const interval = setInterval(async () => {
        try {
          const pct = await fileApi.getProgress(deviceId, transferId);
          if (pct !== null) {
            setToasts((prev) =>
              prev.map((t) =>
                t.id === toastId && t.type === 'info'
                  ? { ...t, progress: pct }
                  : t
              )
            );
          }
        } catch {
          // ignore polling errors
        }
      }, 500);
      return () => clearInterval(interval);
    };

    if (pickerAction === 'upload') {
      // Push local files/folders directly to device
      for (const localPath of paths) {
        const name = localPath.replace(/\\/g, '/').split('/').pop() || localPath;
        const toastId = `push-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transferId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [
          ...prev,
          {
            id: toastId,
            type: 'info',
            message: `Pushing: ${name}...`,
            progress: 0,
            onCancel: () => cancelTransfer(selectedDevice.id, transferId, toastId),
          },
        ]);

        const stopPolling = startProgressPoll(selectedDevice.id, transferId, toastId);
        try {
          await fileApi.pushLocal(selectedDevice.id, localPath, currentPath, transferId);
          stopPolling();
          setToasts((prev) =>
            prev.map((t) =>
              t.id === toastId
                ? { ...t, type: 'success' as const, message: `Pushed: ${name}`, onCancel: undefined, progress: undefined }
                : t
            )
          );
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, 4000);
        } catch (err) {
          stopPolling();
          const msg = err instanceof Error ? err.message : 'Unknown error';
          const cancelled = msg.toLowerCase().includes('cancel');
          setToasts((prev) =>
            prev.map((t) =>
              t.id === toastId
                ? {
                    ...t,
                    type: cancelled ? ('info' as const) : ('error' as const),
                    message: cancelled ? `Cancelled: ${name}` : `Failed: ${name}: ${msg}`,
                    onCancel: undefined,
                    progress: undefined,
                  }
                : t
            )
          );
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, cancelled ? 3000 : 6000);
        }
      }
      refresh();
    } else {
      // Pull device files to local directory
      const localDir = paths[0];
      for (const remotePath of selectedFiles) {
        const name = remotePath.split('/').pop() || remotePath;
        const toastId = `pull-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transferId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [
          ...prev,
          {
            id: toastId,
            type: 'info',
            message: `Pulling: ${name}...`,
            progress: 0,
            onCancel: () => cancelTransfer(selectedDevice.id, transferId, toastId),
          },
        ]);

        const stopPolling = startProgressPoll(selectedDevice.id, transferId, toastId);
        try {
          const result = await fileApi.pullToLocal(selectedDevice.id, remotePath, localDir, transferId);
          stopPolling();
          setToasts((prev) =>
            prev.map((t) =>
              t.id === toastId
                ? { ...t, type: 'success' as const, message: `Saved: ${name} → ${result.path}`, onCancel: undefined, progress: undefined }
                : t
            )
          );
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, 4000);
        } catch (err) {
          stopPolling();
          const msg = err instanceof Error ? err.message : 'Unknown error';
          const cancelled = msg.toLowerCase().includes('cancel');
          setToasts((prev) =>
            prev.map((t) =>
              t.id === toastId
                ? {
                    ...t,
                    type: cancelled ? ('info' as const) : ('error' as const),
                    message: cancelled ? `Cancelled: ${name}` : `Failed: ${name}: ${msg}`,
                    onCancel: undefined,
                    progress: undefined,
                  }
                : t
            )
          );
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toastId));
          }, cancelled ? 3000 : 6000);
        }
      }
      clearSelection();
    }
  }, [selectedDevice, currentPath, pickerAction, selectedFiles, refresh, clearSelection]);

  const handleDownload = useCallback(async () => {
    if (!selectedDevice || selectedFiles.size === 0) return;
    setPickerMode('directory');
    setPickerTitle('Choose Download Destination');
    setPickerAction('download');
    setPickerOpen(true);
  }, [selectedDevice, selectedFiles]);

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

      {/* Local file picker for upload/download */}
      <LocalFilePicker
        isOpen={pickerOpen}
        mode={pickerMode}
        title={pickerTitle}
        onSelect={handlePickerSelect}
        onCancel={() => setPickerOpen(false)}
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
