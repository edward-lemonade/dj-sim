import { useAuth } from '@clerk/react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import HomePage from '@/pages/home/HomePage';
import StudioPage from '@/pages/Studio';
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
    element: <HomePage />,
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
