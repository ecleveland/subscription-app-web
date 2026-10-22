'use client';

import { useState, useEffect, FormEvent } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

export default function ProfileForm() {
  const { user, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setEmail(user.email ?? '');
      setAvatarUrl(user.avatarUrl ?? '');
    }
  }, [user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName || undefined,
          email: email || undefined,
          avatarUrl: avatarUrl || undefined,
        }),
      });
      await refreshProfile();
      showSuccessToast('Profile updated successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClasses =
    'input';

  return (
    <div>
      <h2 className="section-title mb-4">
        Profile Information
      </h2>
      {avatarUrl && (
        <div className="mb-4">
          <Image
            src={avatarUrl}
            alt="Avatar"
            width={80}
            height={80}
            className="rounded-full object-cover border-2 border-line"
            unoptimized
          />
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label
            htmlFor="profile-username"
            className="label"
          >
            Username
          </label>
          <input
            id="profile-username"
            type="text"
            value={user?.username ?? ''}
            disabled
            className={`${inputClasses} opacity-50 cursor-not-allowed`}
          />
        </div>
        <div>
          <label
            htmlFor="profile-displayName"
            className="label"
          >
            Display Name
          </label>
          <input
            id="profile-displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="profile-email"
            className="label"
          >
            Email
          </label>
          <input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClasses}
          />
        </div>
        <div>
          <label
            htmlFor="profile-avatarUrl"
            className="label"
          >
            Avatar URL
          </label>
          <input
            id="profile-avatarUrl"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className={inputClasses}
            placeholder="https://example.com/avatar.jpg"
          />
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
