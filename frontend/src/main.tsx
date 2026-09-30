import { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ClerkProvider, useAuth } from '@clerk/react';
import { RouterProvider } from 'react-router-dom';
import { router } from './config/router.tsx';
import { ENV } from './config/env';
import { setAuthTokenGetter } from '@/lib/clients/axios';
import { TooltipProvider } from './components/ui/tooltip.tsx';

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
      <TooltipProvider delay={0.2}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ClerkProvider>
  </StrictMode>,
);
