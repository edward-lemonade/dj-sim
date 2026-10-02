import { SignIn } from '@clerk/react';
import { useSearchParams } from 'react-router-dom';
import { safeAuthRedirect } from '@/lib/rooms/join';

export function LoginPage() {
  const [params] = useSearchParams();

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
      <SignIn
        path="/login"
        routing="path"
        signUpUrl="/register"
        forceRedirectUrl={safeAuthRedirect(params.get('redirect'))}
      />
    </div>
  );
}

export default LoginPage;
