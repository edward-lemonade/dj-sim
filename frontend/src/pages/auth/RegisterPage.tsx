import { SignUp } from '@clerk/react';
import { useSearchParams } from 'react-router-dom';
import { safeAuthRedirect } from '@/lib/utils/joinRoom';

export function RegisterPage() {
  const [params] = useSearchParams();

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
      <SignUp
        path="/register"
        routing="path"
        signInUrl="/login"
        forceRedirectUrl={safeAuthRedirect(params.get('redirect'))}
      />
    </div>
  );
}

export default RegisterPage;
