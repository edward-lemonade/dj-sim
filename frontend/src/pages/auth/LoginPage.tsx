import { SignIn } from '@clerk/react';

export function LoginPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem' }}>
      <SignIn
        path="/login"
        routing="path"
        signUpUrl="/register"
        forceRedirectUrl="/"
      />
    </div>
  );
}

export default LoginPage;
