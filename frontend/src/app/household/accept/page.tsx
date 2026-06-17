import AcceptInvitationForm from '@/components/AcceptInvitationForm';

export default function AcceptInvitationPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Accept Invitation
      </h1>
      <AcceptInvitationForm />
    </div>
  );
}
