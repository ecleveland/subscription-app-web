import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulkActionToolbar from '../BulkActionToolbar';

function renderToolbar(overrides = {}) {
  const props = {
    selectedCount: 3,
    totalCount: 10,
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onBulkDelete: vi.fn(),
    onBulkActivate: vi.fn(),
    onBulkDeactivate: vi.fn(),
    onBulkChangeCategory: vi.fn(),
    loading: false,
    ...overrides,
  };
  render(<BulkActionToolbar {...props} />);
  return props;
}

describe('BulkActionToolbar', () => {
  it('should render selected count', () => {
    renderToolbar();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('should call onBulkDelete when Delete is clicked', async () => {
    const props = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(props.onBulkDelete).toHaveBeenCalled();
  });

  it('should call onBulkActivate when Activate is clicked', async () => {
    const props = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /^activate$/i }));
    expect(props.onBulkActivate).toHaveBeenCalled();
  });

  it('should call onBulkDeactivate when Deactivate is clicked', async () => {
    const props = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(props.onBulkDeactivate).toHaveBeenCalled();
  });

  it('should call onSelectAll when Select all is clicked', async () => {
    const props = renderToolbar();
    await userEvent.click(screen.getByText('Select all'));
    expect(props.onSelectAll).toHaveBeenCalled();
  });

  it('should show Deselect all when all are selected', async () => {
    const props = renderToolbar({ selectedCount: 10, totalCount: 10 });
    await userEvent.click(screen.getByText('Deselect all'));
    expect(props.onDeselectAll).toHaveBeenCalled();
  });

  it('should disable buttons when loading', () => {
    renderToolbar({ loading: true });
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeDisabled();
  });
});
