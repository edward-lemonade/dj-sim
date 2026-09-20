import { SignUp } from '@clerk/react';

export function RegisterPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
      <SignUp
        path="/register"
        routing="path"
        signInUrl="/login"
        forceRedirectUrl="/"
      />
    </div>
  );
}

export default RegisterPage;
