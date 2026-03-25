import { useEffect, useCallback, useState, useRef } from 'react';
import { useDevices } from './hooks/useDevices';
import { useFileBrowser } from './hooks/useFileBrowser';
import { DeviceSelector } from './components/DeviceSelector';
import { WirelessConnect } from './components/WirelessConnect';
import { Toolbar } from './components/Toolbar';
import { FileList } from './components/FileList';
import { InputModal, ConfirmModal } from './components/Modal';
import { LocalFilePicker, PickerMode } from './components/LocalFilePicker';
import { Toast, ToastMessage } from './components/Toast';
import { TransferQueue, TransferItem } from './components/TransferQueue';
import { fileApi, deviceApi } from './services/api';
import type { FileEntry, DeviceStorageInfo } from './types';
import styles from './App.module.css';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

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
    selectRange,
    clearSelection,
    selectAll,
  } = useFileBrowser(selectedDevice?.id ?? null);

  // Modals state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [storageInfo, setStorageInfo] = useState<DeviceStorageInfo[]>([]);

  // Local file picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('files');
  const [pickerTitle, setPickerTitle] = useState<string | undefined>();
  const [pickerAction, setPickerAction] = useState<'upload' | 'download'>('upload');

  // Load files when device changes
  useEffect(() => {
    if (selectedDevice?.state === 'device') {
      navigateTo(currentPath || '/storage');
      // Fetch storage info
      deviceApi.getStorageInfo(selectedDevice.id)
        .then(setStorageInfo)
        .catch(() => setStorageInfo([]));
    } else {
      setStorageInfo([]);
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

  // Transfer queue helpers
  const updateTransfer = useCallback((id: string, patch: Partial<TransferItem>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismissTransfer = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompletedTransfers = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === 'active' || t.status === 'queued'));
  }, []);

  // Serial transfer queue — chains each transfer onto a promise so only one runs at a time
  const queueTail = useRef<Promise<void>>(Promise.resolve());

  const enqueueTransfer = useCallback((
    item: TransferItem,
    execute: (itemId: string, transferId: string) => Promise<void>,
  ) => {
    // Add item to UI immediately as 'queued'
    setTransfers((prev) => [...prev, item]);

    // Chain onto serial queue
    queueTail.current = queueTail.current.then(async () => {
      // Mark as active
      const cancelFn = item.onCancel;
      setTransfers((prev) =>
        prev.map((t) => (t.id === item.id ? { ...t, status: 'active' as const, onCancel: cancelFn } : t))
      );

      await execute(item.id, item.transferId);
    });
  }, []);

  const handlePickerSelect = useCallback(async (paths: string[]) => {
    setPickerOpen(false);
    if (!selectedDevice || paths.length === 0) return;

    const deviceId = selectedDevice.id;

    const cancelTransfer = (transferId: string, itemId: string) => {
      fileApi.cancelTransfer(deviceId, transferId).catch(() => {});
      updateTransfer(itemId, { status: 'cancelled', onCancel: undefined });
    };

    // Start polling progress for a transfer, returns cleanup function
    const startProgressPoll = (transferId: string, itemId: string) => {
      const interval = setInterval(async () => {
        try {
          const info = await fileApi.getProgress(deviceId, transferId);
          if (info !== null) {
            setTransfers((prev) =>
              prev.map((t) =>
                t.id === itemId && t.status === 'active'
                  ? { ...t, progress: info.progress, speedBps: info.speedBps }
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
      const remoteDest = currentPath;
      for (const localPath of paths) {
        const name = localPath.replace(/\\/g, '/').split('/').pop() || localPath;
        const itemId = `push-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transferId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const item: TransferItem = {
          id: itemId,
          transferId,
          fileName: name,
          direction: 'push',
          status: 'queued',
          progress: 0,
          speedBps: 0,
          onCancel: () => cancelTransfer(transferId, itemId),
        };

        enqueueTransfer(item, async (iid, tid) => {
          const stopPolling = startProgressPoll(tid, iid);
          try {
            await fileApi.pushLocal(deviceId, localPath, remoteDest, tid);
            stopPolling();
            updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
          } catch (err) {
            stopPolling();
            const msg = err instanceof Error ? err.message : 'Unknown error';
            const cancelled = msg.toLowerCase().includes('cancel');
            updateTransfer(iid, {
              status: cancelled ? 'cancelled' : 'failed',
              error: cancelled ? undefined : msg,
              onCancel: undefined,
            });
          }
          refresh();
        });
      }
    } else {
      const localDir = paths[0];
      for (const remotePath of selectedFiles) {
        const name = remotePath.split('/').pop() || remotePath;
        const itemId = `pull-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const transferId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const item: TransferItem = {
          id: itemId,
          transferId,
          fileName: name,
          direction: 'pull',
          status: 'queued',
          progress: 0,
          speedBps: 0,
          onCancel: () => cancelTransfer(transferId, itemId),
        };

        enqueueTransfer(item, async (iid, tid) => {
          const stopPolling = startProgressPoll(tid, iid);
          try {
            await fileApi.pullToLocal(deviceId, remotePath, localDir, tid);
            stopPolling();
            updateTransfer(iid, { status: 'completed', progress: 100, speedBps: 0, onCancel: undefined });
          } catch (err) {
            stopPolling();
            const msg = err instanceof Error ? err.message : 'Unknown error';
            const cancelled = msg.toLowerCase().includes('cancel');
            updateTransfer(iid, {
              status: cancelled ? 'cancelled' : 'failed',
              error: cancelled ? undefined : msg,
              onCancel: undefined,
            });
          }
        });
      }
      clearSelection();
    }
  }, [selectedDevice, currentPath, pickerAction, selectedFiles, refresh, clearSelection, updateTransfer, enqueueTransfer]);

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
    navigateTo('/storage');
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
          {/* Storage info */}
          {storageInfo.length > 0 && (
            <div className={styles.storageBar}>
              {storageInfo.map((s) => {
                const usedPct = s.total > 0 ? (s.used / s.total) * 100 : 0;
                const color = usedPct > 90 ? 'var(--danger)' : usedPct > 75 ? '#f39c12' : 'var(--accent)';
                const label = s.mount_point.includes('sdcard') || s.mount_point.includes('emulated')
                  ? 'Internal' : s.mount_point.split('/').pop() || s.mount_point;
                return (
                  <div key={s.mount_point} className={styles.storageItem}>
                    <div className={styles.storageRow}>
                      <span className={styles.storageLabel}>{label}</span>
                      <span className={styles.storageText}>{formatBytes(s.available)} free / {formatBytes(s.total)}</span>
                    </div>
                    <div className={styles.storageMeter}>
                      <div className={styles.storageFill} style={{ width: `${usedPct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DeviceSelector
            devices={devices}
            selectedDevice={selectedDevice}
            onSelect={setSelectedDevice}
            onRefresh={refreshDevices}
            loading={devicesLoading}
          />
          <WirelessConnect
            usbDevices={devices.filter((d) => d.state === 'device' && !d.id.includes(':'))}
            onConnected={refreshDevices}
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
                onSelectRange={selectRange}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
                loading={filesLoading}
              />
              {/* Transfer queue (inline panel below file list) */}
              <TransferQueue
                transfers={transfers}
                onDismiss={dismissTransfer}
                onClearCompleted={clearCompletedTransfers}
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
