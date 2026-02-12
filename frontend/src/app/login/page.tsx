import LoginForm from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Subscription Tracker
        </h1>
        <LoginForm />
      </div>
    </div>
  );
}
