import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExitConfirmModal } from '@/pages/studio/components/ExitConfirmModal';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export function StudioTopbar() {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <header className="flex h-8 shrink-0 items-center border-b border-zinc-800 bg-[#0b0d10] px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-zinc-300 hover:bg-zinc-800"
          aria-label="Exit studio"
          onClick={() => setConfirmOpen(true)}
        >
          <Home />
        </Button>
      </header>
      <ExitConfirmModal
        open={confirmOpen}
        onNo={() => setConfirmOpen(false)}
        onYes={() => {
          setConfirmOpen(false);
          navigate('/');
        }}
      />
    </>
  );
}
