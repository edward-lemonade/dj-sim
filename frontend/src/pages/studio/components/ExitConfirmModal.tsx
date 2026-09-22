import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function ExitConfirmModal({
  open,
  onYes,
  onNo,
}: {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onNo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onNo]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Cancel exit"
        onClick={onNo}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-studio-title"
        className="relative z-10 w-[min(22rem,calc(100%-2rem))] rounded-md border border-zinc-700 bg-[#161a20] p-4 text-zinc-100 shadow-xl"
      >
        <p id="exit-studio-title" className="text-sm">
          Are you sure you want to exit?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onNo}>
            No
          </Button>
          <Button type="button" onClick={onYes}>
            Yes
          </Button>
        </div>
      </div>
    </div>
  );
}
