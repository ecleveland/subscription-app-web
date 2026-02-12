'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Subscription } from '@/lib/types';
import SubscriptionForm from '@/components/SubscriptionForm';

export default function EditSubscriptionPage() {
  const params = useParams<{ id: string }>();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Subscription>(`/subscriptions/${params.id}`)
      .then(setSubscription)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-red-500">{error || 'Subscription not found'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Edit Subscription
      </h1>
      <SubscriptionForm subscription={subscription} />
    </div>
  );
}
