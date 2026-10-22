import { Suspense } from 'react';
import LoginForm from '@/components/LoginForm';
import AuthShell from '@/components/AuthShell';

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" lede="Sign in to see what is due next.">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
