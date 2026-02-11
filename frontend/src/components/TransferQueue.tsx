import { useState } from 'react';
import {
  Upload,
  Download,
  X,
  StopCircle,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import styles from './TransferQueue.module.css';

export type TransferDirection = 'push' | 'pull';
export type TransferStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface TransferItem {
  id: string;
  transferId: string;
  fileName: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number; // 0-100
  speedBps: number; // bytes per second
  error?: string;
  onCancel?: () => void;
}

interface TransferQueueProps {
  transfers: TransferItem[];
  onDismiss: (id: string) => void;
  onClearCompleted: () => void;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '';
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

export function TransferQueue({ transfers, onDismiss, onClearCompleted }: TransferQueueProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (transfers.length === 0) return null;

  const activeCount = transfers.filter((t) => t.status === 'active').length;
  const completedCount = transfers.filter((t) => t.status !== 'active').length;

  return (
    <div className={styles.panel}>
      {/* Header bar — always visible */}
      <button className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.headerTitle}>
          Transfers
          {activeCount > 0 && (
            <span className={styles.badge}>{activeCount} active</span>
          )}
        </span>
        <span className={styles.headerActions}>
          {completedCount > 0 && (
            <span
              className={styles.clearBtn}
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearCompleted();
              }}
              title="Clear completed"
            >
              <Trash2 size={14} />
            </span>
          )}
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* Transfer list */}
      {!collapsed && (
        <div className={styles.list}>
          {transfers.map((t) => (
            <div key={t.id} className={`${styles.item} ${styles[t.status]}`}>
              {/* Icon */}
              <span className={styles.icon}>
                {t.status === 'completed' ? (
                  <CheckCircle size={16} />
                ) : t.status === 'failed' ? (
                  <AlertCircle size={16} />
                ) : t.direction === 'push' ? (
                  <Upload size={16} />
                ) : (
                  <Download size={16} />
                )}
              </span>

              {/* Info + progress */}
              <div className={styles.info}>
                <span className={styles.name} title={t.fileName}>
                  {t.fileName}
                </span>
                {t.status === 'active' && (
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                )}
                {t.status === 'failed' && t.error && (
                  <span className={styles.error}>{t.error}</span>
                )}
                {t.status === 'cancelled' && (
                  <span className={styles.cancelled}>Cancelled</span>
                )}
              </div>

              {/* Speed + percentage for active */}
              {t.status === 'active' && (
                <span className={styles.stats}>
                  {t.speedBps > 0 && (
                    <span className={styles.speed}>{formatSpeed(t.speedBps)}</span>
                  )}
                  <span className={styles.pct}>{Math.round(t.progress)}%</span>
                </span>
              )}

              {/* Cancel / dismiss */}
              {t.status === 'active' && t.onCancel ? (
                <button
                  className={styles.cancelBtn}
                  onClick={() => t.onCancel?.()}
                  title="Cancel transfer"
                >
                  <StopCircle size={16} />
                </button>
              ) : t.status !== 'active' ? (
                <button
                  className={styles.dismissBtn}
                  onClick={() => onDismiss(t.id)}
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
