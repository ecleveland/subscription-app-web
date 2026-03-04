'use client';

import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme-context';

export default function ToastProvider() {
  const { theme } = useTheme();

  return (
    <Toaster
      theme={theme}
      position="top-right"
      richColors
      closeButton
      duration={5000}
    />
  );
}
