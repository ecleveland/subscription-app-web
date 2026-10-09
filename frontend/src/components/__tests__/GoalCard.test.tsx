import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalCard from '@/components/GoalCard';
import type { Goal } from '@/lib/types';

function goal(over: Partial<Goal> = {}): Goal {
  return {
    _id: 'g1',
    householdId: 'h',
    name: 'Emergency fund',
    type: 'savings',
    targetCents: 100000,
    currentCents: 50000,
    targetDate: null,
    categoryId: null,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function renderCard(over: Partial<Goal> = {}) {
  const props = {
    onEdit: vi.fn(),
    onArchiveToggle: vi.fn(),
    onContribute: vi.fn().mockResolvedValue(true),
  };
  render(<GoalCard goal={goal(over)} {...props} />);
  return props;
}

function bar() {
  return screen.getByRole('progressbar').firstElementChild as HTMLElement;
}

describe('GoalCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows name, type badge, amounts, and a 50% bar', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Emergency fund' })).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('$500.00 of $1,000.00')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(bar().style.width).toBe('50%');
  });

  it('labels a debt goal', () => {
    renderCard({ type: 'debt' });
    expect(screen.getByText('Debt')).toBeInTheDocument();
  });

  it('shows 0% with an empty bar', () => {
    renderCard({ currentCents: 0 });
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(bar().style.width).toBe('0%');
  });

  it('shows the true percent past the target but clamps the bar at 100%', () => {
    renderCard({ currentCents: 120000 });
    expect(screen.getByText('120%')).toBeInTheDocument();
    expect(bar().style.width).toBe('100%');
  });

  it('omits the date line without a target date', () => {
    renderCard();
    expect(screen.queryByText(/days? (left|overdue)|Due today/)).toBeNull();
  });

  describe('target date', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-08T15:00:00Z'));
    });

    it('shows the date and days left', () => {
      renderCard({ targetDate: '2026-10-18' });
      expect(screen.getByText(/Oct 18, 2026/)).toBeInTheDocument();
      expect(screen.getByText(/10 days left/)).toBeInTheDocument();
    });

    it('uses the singular for one day', () => {
      renderCard({ targetDate: '2026-10-09' });
      expect(screen.getByText(/1 day left/)).toBeInTheDocument();
    });

    it('says due today', () => {
      renderCard({ targetDate: '2026-10-08T00:00:00.000Z' });
      expect(screen.getByText(/Due today/)).toBeInTheDocument();
    });

    it('says overdue', () => {
      renderCard({ targetDate: '2026-10-05' });
      expect(screen.getByText(/3 days overdue/)).toBeInTheDocument();
    });
  });

  it('submits a contribution in cents and clears the input', async () => {
    const user = userEvent.setup();
    const { onContribute } = renderCard();
    const input = screen.getByLabelText('Contribution ($)');
    await user.type(input, '25.50');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onContribute).toHaveBeenCalledWith('g1', 2550);
    await waitFor(() => expect(input).toHaveValue(null));
  });

  it('sends a negative contribution as negative cents', async () => {
    const user = userEvent.setup();
    const { onContribute } = renderCard();
    await user.type(screen.getByLabelText('Contribution ($)'), '-10');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onContribute).toHaveBeenCalledWith('g1', -1000);
  });

  it('keeps the input when the contribution fails', async () => {
    const user = userEvent.setup();
    const props = {
      onEdit: vi.fn(),
      onArchiveToggle: vi.fn(),
      onContribute: vi.fn().mockResolvedValue(false),
    };
    render(<GoalCard goal={goal()} {...props} />);
    const input = screen.getByLabelText('Contribution ($)');
    await user.type(input, '5');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(props.onContribute).toHaveBeenCalled());
    expect(input).toHaveValue(5);
  });

  it('rejects a zero contribution inline', async () => {
    const user = userEvent.setup();
    const { onContribute } = renderCard();
    await user.type(screen.getByLabelText('Contribution ($)'), '0');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Enter a nonzero amount')).toBeInTheDocument();
    expect(onContribute).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places inline', async () => {
    const user = userEvent.setup();
    const { onContribute } = renderCard();
    await user.type(screen.getByLabelText('Contribution ($)'), '1.234');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument();
    expect(onContribute).not.toHaveBeenCalled();
  });

  it('wires Edit and Archive', async () => {
    const user = userEvent.setup();
    const { onEdit, onArchiveToggle } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ _id: 'g1' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchiveToggle).toHaveBeenCalledWith(expect.objectContaining({ _id: 'g1' }));
  });

  it('dims an archived goal and offers Unarchive', () => {
    renderCard({ isArchived: true });
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveClass('opacity-60');
  });
});
