import { UserButton, useAuth } from '@clerk/react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';
type NavItem = { to: string; label: string; end?: boolean };

const navItems: NavItem[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/tracks', label: 'Tracks' },
  { to: '/skills', label: 'Skills' },
];

function AppLayout() {
  const { pathname } = useLocation();
  const isTracks = pathname === '/tracks';

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.16),_transparent_45%),linear-gradient(180deg,#05070d_0%,#0a0e17_45%,#0d1119_100%)] text-slate-100">
      {/* Flush top bar: fixed height, full width, identical on every route */}
      <header className="grid h-16 w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/10 bg-[#05070d]/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
        <NavLink to="/" className="justify-self-start text-lg font-semibold tracking-tight text-white">
          Lemonade DJ Sim
        </NavLink>

        <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="justify-self-end">
          <HeaderAuth />
        </div>
      </header>

      {/* Content: tracks page fills the remaining space edge-to-edge, other
          pages get a centered readable column. Neither is a floating "bubble". */}
      <div className={cn('flex min-h-0 flex-1 flex-col', isTracks ? 'overflow-hidden' : 'overflow-y-auto')}>
        <div
          className={cn(
            isTracks
              ? 'flex h-full min-h-0 flex-1 flex-col'
              : 'mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8',
          )}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function HeaderAuth() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="h-8 w-[9.5rem]" />;
  }

  if (isSignedIn) {
    return <UserButton />;
  }

  return (
    <div className="flex items-center gap-2">
      <Link to="/login" className={cn(buttonVariants({ variant: 'ghost' }), 'rounded-full')}>
        Login
      </Link>
      <Link to="/register" className={cn(buttonVariants(), 'rounded-full')}>
        Register
      </Link>
    </div>
  );
}

export default AppLayout;