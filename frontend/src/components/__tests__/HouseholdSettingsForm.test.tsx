import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HouseholdSettingsForm from '../HouseholdSettingsForm';

vi.mock('@/lib/households', () => ({
  updateHousehold: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

let householdCtx: Record<string, unknown>;
vi.mock('@/lib/household-context', () => ({
  useHousehold: () => householdCtx,
}));

import { updateHousehold } from '@/lib/households';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

const household = {
  _id: 'h1',
  name: 'The Smiths',
  currency: 'USD',
  ownerId: 'u1',
};

describe('HouseholdSettingsForm', () => {
  const refresh = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefills and saves the household when the caller is the owner', async () => {
    householdCtx = { household, isOwner: true, refresh };
    vi.mocked(updateHousehold).mockResolvedValueOnce({
      ...household,
      name: 'The Joneses',
    } as never);
    const user = userEvent.setup();

    render(<HouseholdSettingsForm />);

    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('The Smiths');
    expect(screen.getByLabelText('Currency')).toHaveValue('USD');

    await user.clear(nameInput);
    await user.type(nameInput, 'The Joneses');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateHousehold).toHaveBeenCalledWith({
        name: 'The Joneses',
        currency: 'USD',
      });
    });
    expect(refresh).toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith(
      'Household updated successfully.',
    );
  });

  it('rejects an invalid currency without calling the API', async () => {
    householdCtx = { household, isOwner: true, refresh };
    const user = userEvent.setup();

    render(<HouseholdSettingsForm />);

    const currency = screen.getByLabelText('Currency');
    await user.clear(currency);
    await user.type(currency, 'US');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(
      screen.getByText('Currency must be a 3-letter code (e.g. USD).'),
    ).toBeInTheDocument();
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it('shows an error toast when the update fails', async () => {
    householdCtx = { household, isOwner: true, refresh };
    vi.mocked(updateHousehold).mockRejectedValueOnce(new Error('Nope'));
    const user = userEvent.setup();

    render(<HouseholdSettingsForm />);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith('Nope');
      expect(screen.getByText('Nope')).toBeInTheDocument();
    });
  });

  it('renders a read-only view for non-owners', () => {
    householdCtx = { household, isOwner: false, refresh };

    render(<HouseholdSettingsForm />);

    expect(
      screen.queryByRole('button', { name: 'Save Changes' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Only the household owner can edit these settings.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The Smiths')).toBeInTheDocument();
  });
});
