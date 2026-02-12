import RegisterForm from '@/components/RegisterForm';
import ThemeToggle from '@/components/ThemeToggle';

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Create Account
        </h1>
        <RegisterForm />
      </div>
    </div>
  );
}
