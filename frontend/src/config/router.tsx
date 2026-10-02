import { useAuth } from '@clerk/react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/home/HomePage';
import TracksPage from '@/pages/tracks/TracksPage';
import StudioPage from '@/pages/studio/StudioPage';
import StreamsPage from '@/pages/streams/StreamsPage';
import StreamViewerPage from '@/pages/streams/StreamViewerPage';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';

function PublicAuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="auth-loading">Loading...</div>;
  }

  if (isSignedIn) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'tracks', element: <TracksPage /> },
      { path: 'streams', element: <StreamsPage /> },
      { path: 'skills', element: <Navigate to="/streams" replace /> },
    ],
  },
  {
    path: '/studio',
    element: <StudioPage />,
  },
  {
    path: '/streams/:streamId',
    element: <StreamViewerPage />,
  },
  {
    path: '/',
    element: <PublicAuthLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'login/*', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'register/*', element: <RegisterPage /> },
    ],
  },
]);
