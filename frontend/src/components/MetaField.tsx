import { useEffect, useRef, useState } from "react";

export function MetaField({
  label,
  value,
  disabled,
  error,
  align = 'left',
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  error?: string;
  align?: 'left' | 'center';
  onCommit: (value: string) => Promise<unknown>;
}) {
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
    } catch {
      setDraft(valueRef.current);
      setFieldError('Could not save');
    }
  };

  return (
    <label className={`min-w-0 ${align === 'center' ? 'text-center' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        className={`w-full truncate bg-transparent text-zinc-100 outline-none disabled:text-zinc-500 ${
          align === 'center' ? 'text-center' : ''
        }`}
      />
      {(fieldError || error) && <p className="text-[10px] text-red-400">{fieldError || error}</p>}
    </label>
  );
}