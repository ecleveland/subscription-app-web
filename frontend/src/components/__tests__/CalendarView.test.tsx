import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarView from '../CalendarView';
import type { Subscription } from '@/lib/types';

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    _id: '1',
    userId: 'u1',
    name: 'Test Sub',
    cost: 10,
    billingCycle: 'monthly',
    nextBillingDate: '2026-03-15',
    category: 'Streaming',
    isActive: true,
    reminderDaysBefore: 3,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

// Fix the "today" date so tests are deterministic
const RealDate = global.Date;

beforeAll(() => {
  const fixedNow = new RealDate(2026, 2, 17); // March 17, 2026
  // @ts-expect-error - overriding Date constructor for tests
  global.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fixedNow.getTime());
      } else {
        // @ts-expect-error - spreading args to Date constructor
        super(...args);
      }
    }

    static now() {
      return fixedNow.getTime();
    }
  };
});

afterAll(() => {
  global.Date = RealDate;
});

describe('CalendarView', () => {
  it('should render month/year header', () => {
    render(<CalendarView subscriptions={[]} />);
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });

  it('should render day-of-week headers', () => {
    render(<CalendarView subscriptions={[]} />);
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('should render navigation buttons', () => {
    render(<CalendarView subscriptions={[]} />);
    expect(screen.getByLabelText('Previous month')).toBeInTheDocument();
    expect(screen.getByLabelText('Next month')).toBeInTheDocument();
  });

  it('should display subscription name on the correct billing day', () => {
    const sub = makeSub({ name: 'Netflix', cost: 15, nextBillingDate: '2026-03-15' });
    render(<CalendarView subscriptions={[sub]} />);
    expect(screen.getByText('Netflix · $15')).toBeInTheDocument();
  });

  it('should not display inactive subscriptions', () => {
    const sub = makeSub({ name: 'Cancelled', isActive: false });
    render(<CalendarView subscriptions={[sub]} />);
    expect(screen.queryByText(/Cancelled/)).not.toBeInTheDocument();
  });

  it('should navigate to next month when clicking next', async () => {
    const user = userEvent.setup();
    render(<CalendarView subscriptions={[]} />);

    await user.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('April 2026')).toBeInTheDocument();
  });

  it('should navigate to previous month when clicking prev', async () => {
    const user = userEvent.setup();
    render(<CalendarView subscriptions={[]} />);

    await user.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('February 2026')).toBeInTheDocument();
  });

  it('should link subscription entries to the edit page', () => {
    const sub = makeSub({ _id: 'sub-123', name: 'Spotify', cost: 10 });
    render(<CalendarView subscriptions={[sub]} />);

    const link = screen.getByText('Spotify · $10');
    expect(link.closest('a')).toHaveAttribute('href', '/subscriptions/sub-123/edit');
  });

  it('should show multiple subscriptions billing on the same day', () => {
    const subs = [
      makeSub({ _id: '1', name: 'Netflix', cost: 15, nextBillingDate: '2026-03-10' }),
      makeSub({ _id: '2', name: 'Spotify', cost: 10, nextBillingDate: '2026-03-10' }),
    ];
    render(<CalendarView subscriptions={subs} />);

    expect(screen.getByText('Netflix · $15')).toBeInTheDocument();
    expect(screen.getByText('Spotify · $10')).toBeInTheDocument();
  });
});
