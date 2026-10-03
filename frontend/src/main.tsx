import { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ClerkProvider, useAuth } from '@clerk/react';
import { RouterProvider } from 'react-router-dom';
import { router } from './config/router.tsx';
import { ENV } from './config/env';
import { setAuthTokenGetter } from '@/lib/clients/axios';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { ToastProvider } from './components/ui/toast.tsx';

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
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </TooltipProvider>
    </ClerkProvider>
  </StrictMode>,
);
