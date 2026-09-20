import { LoaderCircle } from 'lucide-react';

export function LoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="loader-shell" role="status" aria-live="polite">
      <LoaderCircle className="loader-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
