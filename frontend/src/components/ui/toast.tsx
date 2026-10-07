import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { API_REQUEST_SLOW_EVENT } from '@/lib/apiEvents';

// eslint-disable-next-line react-refresh/only-export-components
export enum ToastVariant {
  Success = 'success',
  Error = 'error',
  Info = 'info',
}

export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  actions?: ToastAction[];
  dedupeKey?: string;
  duration?: number;
};

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  actions?: ToastAction[];
  dedupeKey?: string;
  duration: number;
};

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { icon: typeof Info; className: string }> = {
  [ToastVariant.Success]: {
    icon: CircleCheck,
    className: 'border-emerald-300/30 bg-emerald-950/95 text-emerald-50',
  },
  [ToastVariant.Error]: {
    icon: CircleAlert,
    className: 'border-rose-300/30 bg-rose-950/95 text-rose-50',
  },
  [ToastVariant.Info]: {
    icon: Info,
    className: 'border-cyan-300/30 bg-slate-950/95 text-slate-50',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = ToastVariant.Info, options: ToastOptions = {}) => {
    const toast: ToastItem = {
      id: ++nextId.current,
      message,
      variant,
      actions: options.actions,
      dedupeKey: options.dedupeKey,
      duration: options.duration ?? (variant === ToastVariant.Error ? 7000 : 5000),
    };
    setToasts((current) => {
      const withoutDuplicate = toast.dedupeKey
        ? current.filter((item) => item.dedupeKey !== toast.dedupeKey)
        : current;
      return [...withoutDuplicate, toast].slice(-4);
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  useEffect(() => {
    const showColdStartNotice = () => {
      showToast('Our server is cold-starting, please wait a few seconds...', ToastVariant.Info, {
        dedupeKey: 'api-cold-start',
      });
    };
    window.addEventListener(API_REQUEST_SLOW_EVENT, showColdStartNotice);
    return () => window.removeEventListener(API_REQUEST_SLOW_EVENT, showColdStartNotice);
  }, [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
        {toasts.map((toast) => {
          const { icon: Icon, className } = variantStyles[toast.variant];
          return (
            <ToastMessage
              key={toast.id}
              toast={toast}
              icon={<Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
              className={className}
              onDismiss={dismissToast}
            />
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({
  toast,
  icon,
  className,
  onDismiss,
}: {
  toast: ToastItem;
  icon: ReactNode;
  className: string;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.duration, toast.id]);

  const role = toast.variant === ToastVariant.Error ? 'alert' : 'status';

  return (
    <div
      role={role}
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${className}`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="break-words">{toast.message}</p>
        {toast.actions && toast.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {toast.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-semibold transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => {
                  action.onClick();
                  onDismiss(toast.id);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="rounded p-0.5 text-current/70 transition hover:bg-white/10 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={() => onDismiss(toast.id)}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider.');
  return context;
}
