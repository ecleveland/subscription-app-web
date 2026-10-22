import { Suspense } from 'react';
import ForgotPasswordForm from '@/components/ForgotPasswordForm';
import AuthShell from '@/components/AuthShell';

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?" lede="Enter your email and we will send a reset link.">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
