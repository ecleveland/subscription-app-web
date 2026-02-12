import SubscriptionForm from '@/components/SubscriptionForm';

export default function NewSubscriptionPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Add Subscription
      </h1>
      <SubscriptionForm />
    </div>
  );
}
