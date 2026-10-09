import { permanentRedirect } from 'next/navigation';

// Subscription analytics moved into the Reports page.
export default function AnalyticsPage() {
  permanentRedirect('/reports');
}
