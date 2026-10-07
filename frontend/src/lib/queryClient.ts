import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

export const queryKeys = {
  recordings: (userId: string | null) => ['recordings', userId] as const,
  trackLibrary: (userId: string | null) => ['track-library', userId] as const,
  streams: ['community', 'streams'] as const,
  rooms: ['community', 'rooms'] as const,
};
