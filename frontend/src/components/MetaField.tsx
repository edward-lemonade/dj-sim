import { useEffect, useRef, useState } from "react";
import { useToast } from '@/components/ui/toast';
import { ToastVariant } from '@/components/ui/toast';

// eslint-disable-next-line react-refresh/only-export-components
export enum MetaFieldAlign {
  Left = 'left',
  Center = 'center',
}

export function MetaField({
  label,
  value,
  disabled,
  error,
  align = MetaFieldAlign.Left,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  error?: string;
  align?: MetaFieldAlign;
  onCommit: (value: string) => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(value);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  draftRef.current = draft;
  valueRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void commit();
    }, 400);
    return () => window.clearTimeout(handle);
    // commit reads refs; debounce only on draft changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const commit = async () => {
    if (disabled || draftRef.current === valueRef.current) return;
    try {
      await onCommit(draftRef.current);
      setFieldError(null);
    } catch (cause) {
      setDraft(valueRef.current);
      const message = cause instanceof Error ? cause.message : `Could not save ${label.toLowerCase()}.`;
      setFieldError(message);
      showToast(message, ToastVariant.Error, { dedupeKey: `track-field-${label}` });
    }
  };

  return (
    <label className={`min-w-0 ${align === MetaFieldAlign.Center ? 'text-center' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        className={`w-full truncate bg-transparent text-zinc-100 outline-none disabled:text-zinc-500 ${
          align === MetaFieldAlign.Center ? 'text-center' : ''
        }`}
      />
      {(fieldError || error) && <p className="text-[10px] text-red-400">{fieldError || error}</p>}
    </label>
  );
}