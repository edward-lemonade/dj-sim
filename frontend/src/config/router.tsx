import { useAuth } from '@clerk/react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/home/HomePage';
import TracksPage from '@/pages/tracks/TracksPage';
import SkillsPage from '@/pages/skills/SkillsPage';
import StudioPage from '@/pages/studio/StudioPage';
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
      { path: 'skills', element: <SkillsPage /> },
    ],
  },
  {
    path: '/studio',
    element: <StudioPage />,
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
