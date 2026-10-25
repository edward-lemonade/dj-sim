import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth, useUser } from '@clerk/react';
import { axiosClient } from '@/lib/clients/axios';
import API_ROUTES from '@/config/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type GuestSessionState = {
  ready: boolean;
  guestUserId: string | null;
  error: string | null;
  claimPrompt: boolean;
  claimBusy: boolean;
  claimError: string | null;
  claimGuestData: () => Promise<void>;
  declineGuestData: () => Promise<void>;
  retry: () => void;
};

const GuestSessionContext = createContext<GuestSessionState>({
  ready: false,
  guestUserId: null,
  error: null,
  claimPrompt: false,
  claimBusy: false,
  claimError: null,
  claimGuestData: async () => undefined,
  declineGuestData: async () => undefined,
  retry: () => undefined,
});

// The context hook belongs with its provider; this is safe for fast refresh.
// eslint-disable-next-line react-refresh/only-export-components
export function useGuestSession() {
  return useContext(GuestSessionContext);
}

type BootstrapResult = {
  identityKey: string;
  guestUserId: string | null;
  error: string | null;
  initialized: boolean;
  claimPrompt: boolean;
};

type GuestSessionResponse = { userId?: string; claimed?: boolean };
type GuestSessionStatusResponse = {
  hasGuestSession?: boolean;
  tracks?: Array<{ id: string; title: string; artist: string }>;
};

export function GuestSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [guestTracks, setGuestTracks] = useState<NonNullable<GuestSessionStatusResponse['tracks']>>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const bootstrapRef = useRef<{
    key: string;
    applied: boolean;
    promise: Promise<{
      guestUserId: string | null;
      claimPrompt: boolean;
      tracks: NonNullable<GuestSessionStatusResponse['tracks']>;
    }>;
  } | null>(null);

  const username =
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    (user ? `user-${user.id.slice(-8)}` : 'DJ');
  const identityKey = isSignedIn ? `clerk:${user?.id ?? 'loading'}` : 'guest';

  useEffect(() => {
    if (!isLoaded || (isSignedIn && !user)) return;
    if (bootstrapRef.current?.key !== identityKey) {
      const promise = isSignedIn
        ? axiosClient
            .get<GuestSessionStatusResponse>(API_ROUTES.user.guestSession)
            .then(({ data }) => {
              return {
                guestUserId: null,
                claimPrompt: Boolean(data.hasGuestSession && data.tracks?.length),
                tracks: data.tracks ?? [],
              };
            })
        : axiosClient
            .post<GuestSessionResponse>(API_ROUTES.guest.session)
            .then(({ data }) => {
              if (!data.userId) throw new Error('Guest session response did not include a user ID.');
              return { guestUserId: data.userId, claimPrompt: false, tracks: [] };
            });
      bootstrapRef.current = { key: identityKey, applied: false, promise };
    }
    if (bootstrapRef.current.applied) {
      return;
    }
    const bootstrap = bootstrapRef.current;

    let cancelled = false;
    void bootstrap.promise
      .then(({ guestUserId, claimPrompt, tracks }) => {
        if (!cancelled) {
          bootstrap.applied = true;
          setGuestTracks(tracks);
          setResult({ identityKey, guestUserId, error: null, initialized: true, claimPrompt });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          bootstrap.applied = true;
          setResult({
            identityKey,
            guestUserId: null,
            error: cause instanceof Error ? cause.message : 'Could not initialize your session.',
            initialized: false,
            claimPrompt: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, identityKey, isLoaded, isSignedIn, user, username]);

  const currentResult = result?.identityKey === identityKey ? result : null;
  const ready = isLoaded && !(isSignedIn && !user) && Boolean(currentResult?.initialized);
  const guestUserId = ready && !isSignedIn ? currentResult?.guestUserId ?? null : null;

  useEffect(() => {
    if (!ready || isSignedIn || !guestUserId) return;
    const touchSession = () => {
      void axiosClient
        .post<GuestSessionResponse>(API_ROUTES.guest.session)
        .then(({ data }) => {
          if (data.userId && data.userId !== guestUserId) {
            setResult({
              identityKey: 'guest',
              guestUserId: data.userId,
              error: null,
              initialized: true,
              claimPrompt: false,
            });
          }
        })
        .catch((cause: unknown) => {
          console.error('Could not refresh guest session:', cause);
        });
    };
    const timer = window.setInterval(touchSession, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [guestUserId, isSignedIn, ready]);

  const retry = () => {
    bootstrapRef.current = null;
    setAttempt((current) => current + 1);
  };

  const finishGuestDecision = () => {
    setResult((current) =>
      current?.identityKey === identityKey ? { ...current, claimPrompt: false } : current,
    );
    setClaimError(null);
  };

  const claimGuestData = async () => {
    setClaimBusy(true);
    setClaimError(null);
    try {
      await axiosClient.post<GuestSessionResponse>(API_ROUTES.user.claimGuest, null, {
        params: { username },
      });
      finishGuestDecision();
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : 'Could not claim your guest data.');
    } finally {
      setClaimBusy(false);
    }
  };

  const declineGuestData = async () => {
    setClaimBusy(true);
    setClaimError(null);
    try {
      await axiosClient.post(API_ROUTES.user.declineGuest);
      finishGuestDecision();
      setGuestTracks([]);
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : 'Could not dismiss the guest session.');
    } finally {
      setClaimBusy(false);
    }
  };

  const value = {
    ready,
    guestUserId,
    error: currentResult?.error ?? null,
    claimPrompt: Boolean(isSignedIn && currentResult?.claimPrompt),
    claimBusy,
    claimError,
    claimGuestData,
    declineGuestData,
    retry,
  };

  if (!ready && currentResult?.error) {
    return (
      <main className="grid min-h-svh place-items-center bg-[#101214] px-6 text-center text-zinc-200">
        <div>
          <p role="alert">Could not start your session.</p>
          <p className="mt-2 max-w-lg text-sm text-zinc-400">{currentResult.error}</p>
          <button className="mt-4 underline" onClick={retry}>Try again</button>
        </div>
      </main>
    );
  }

  return (
    <GuestSessionContext.Provider value={value}>
      {children}
      <Dialog open={value.claimPrompt} onOpenChange={() => undefined}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85svh] flex-col gap-4 overflow-hidden border border-white/10 bg-[#101419] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,.65)] ring-white/10 sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-white">Claim your guest data?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              We found unsaved tracks. Do you want them moved to this account? If not, they will be erased.
            </DialogDescription>
          </DialogHeader>
          <section aria-label="Guest tracks" className="grid min-h-0 gap-2">
            <h3 className="text-sm font-semibold text-zinc-200">
              {guestTracks.length} {guestTracks.length === 1 ? 'track' : 'tracks'}
            </h3>
            <ul className="h-56 min-h-0 divide-y divide-white/10 overflow-y-scroll overscroll-contain rounded-lg border border-white/10 bg-[#0b0e13]">
              {guestTracks.map((track) => (
                <li key={track.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-cyan-300/10 text-xs font-semibold text-cyan-200">
                    ♪
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">{track.title}</span>
                    <span className="block truncate text-xs text-zinc-400">{track.artist || 'Unknown artist'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {claimError && <p role="alert" className="text-sm text-red-400">{claimError}</p>}
          <DialogFooter className="border-white/10 bg-[#0b0e13]">
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              disabled={claimBusy}
              onClick={declineGuestData}
            >
              {claimBusy ? 'Please wait...' : 'No'}
            </Button>
            <Button
              type="button"
              className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"
              disabled={claimBusy}
              onClick={claimGuestData}
            >
              {claimBusy ? 'Please wait...' : 'Yes, claim my data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GuestSessionContext.Provider>
  );
}
