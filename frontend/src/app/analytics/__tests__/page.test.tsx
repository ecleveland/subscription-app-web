vi.mock('next/navigation', () => ({ permanentRedirect: vi.fn() }));

import { permanentRedirect } from 'next/navigation';
import AnalyticsPage from '@/app/analytics/page';

describe('AnalyticsPage', () => {
  it('permanently redirects to /reports', () => {
    AnalyticsPage();
    expect(permanentRedirect).toHaveBeenCalledWith('/reports');
  });
});
