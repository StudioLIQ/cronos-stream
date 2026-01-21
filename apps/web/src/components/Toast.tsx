import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  expiresAt: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000) => {
    const id = ++toastIdCounter;
    const toast: Toast = {
      id,
      message,
      type,
      expiresAt: Date.now() + duration,
    };

    setToasts((prev) => [...prev, toast]);

    // Auto-remove after duration
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
}

const typeStyles: Record<ToastType, { background: string; border: string; icon: string }> = {
  info: { background: 'rgba(59, 130, 246, 0.95)', border: '#3b82f6', icon: 'i' },
  success: { background: 'rgba(16, 185, 129, 0.95)', border: '#10b981', icon: '\u2713' },
  warning: { background: 'rgba(245, 158, 11, 0.95)', border: '#f59e0b', icon: '!' },
  error: { background: 'rgba(239, 68, 68, 0.95)', border: '#ef4444', icon: '\u2717' },
};

export function ToastHost() {
  const { toasts, removeToast } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 9999,
        pointerEvents: 'none',
        maxWidth: '380px',
      }}
    >
      {toasts.map((toast) => {
        const style = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              background: style.background,
              color: '#fff',
              padding: '12px 16px',
              borderRadius: '8px',
              borderLeft: `4px solid ${style.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              animation: 'toast-slide-in 0.3s ease-out',
              pointerEvents: 'auto',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
          >
            <span
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '14px',
                flexShrink: 0,
              }}
            >
              {style.icon}
            </span>
            <span style={{ flex: 1, fontSize: '14px', lineHeight: 1.4 }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                padding: '4px',
                fontSize: '16px',
                lineHeight: 1,
              }}
              aria-label="Dismiss"
            >
              \u00d7
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toast-slide-in {
          0% { transform: translateX(100px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
