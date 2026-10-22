import { Suspense } from 'react';
import RegisterForm from '@/components/RegisterForm';
import AuthShell from '@/components/AuthShell';

export default function RegisterPage() {
  return (
    <AuthShell title="Create your account" lede="A few seconds, then the ledger is yours.">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
