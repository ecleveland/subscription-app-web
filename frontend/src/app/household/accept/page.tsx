import { Suspense } from 'react';
import AcceptInvitationForm from '@/components/AcceptInvitationForm';

export default function AcceptInvitationPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <h1 className="page-title mb-6">
        Accept Invitation
      </h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <AcceptInvitationForm />
      </Suspense>
    </div>
  );
}
