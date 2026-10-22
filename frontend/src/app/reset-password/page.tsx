import { Suspense } from 'react';
import ResetPasswordForm from '@/components/ResetPasswordForm';
import AuthShell from '@/components/AuthShell';

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" lede="Pick something you will not reuse elsewhere.">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
