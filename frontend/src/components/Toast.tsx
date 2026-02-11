import { AlertCircle, CheckCircle, Info, X, StopCircle } from 'lucide-react';
import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  progress?: number; // 0-100, undefined means no progress bar
  onCancel?: () => void; // if set, show a cancel button
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <div 
          key={toast.id} 
          className={`${styles.toast} ${styles[toast.type]}`}
        >
          {toast.type === 'success' && <CheckCircle size={18} />}
          {toast.type === 'error' && <AlertCircle size={18} />}
          {toast.type === 'info' && <Info size={18} />}
          <div className={styles.body}>
            <span className={styles.message}>{toast.message}</span>
            {toast.progress !== undefined && (
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${toast.progress}%` }}
                />
              </div>
            )}
          </div>
          {toast.onCancel && (
            <button
              className={styles.cancelBtn}
              onClick={toast.onCancel}
              title="Cancel transfer"
            >
              <StopCircle size={16} />
            </button>
          )}
          <button 
            className={styles.dismissBtn}
            onClick={() => onDismiss(toast.id)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
