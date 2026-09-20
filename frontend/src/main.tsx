import { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ClerkProvider, useAuth } from '@clerk/react';
import { RouterProvider } from 'react-router-dom';
import { router } from './config/router.tsx';
import { ENV } from './config/env';
import { setAuthTokenGetter } from '@/lib/clients/axios';

function ClerkAxiosBridge() {
  const { getToken } = useAuth();

  useLayoutEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={ENV.clerk.publishableKey}>
      <ClerkAxiosBridge />
      <RouterProvider router={router} />
    </ClerkProvider>
  </StrictMode>,
);
