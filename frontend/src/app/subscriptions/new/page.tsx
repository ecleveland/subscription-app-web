import SubscriptionForm from '@/components/SubscriptionForm';

export default function NewSubscriptionPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-10">
      <h1 className="page-title mb-6">
        Add Subscription
      </h1>
      <SubscriptionForm />
    </div>
  );
}
