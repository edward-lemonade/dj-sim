export const ENV = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080',
  clerk: {
    publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '',
  },
} as const;
