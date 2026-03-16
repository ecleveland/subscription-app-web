import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchInput from '../SearchInput';

describe('SearchInput', () => {
  it('should render input with placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search subscriptions…')).toBeInTheDocument();
  });

  it('should render input with custom placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Find something" />);
    expect(screen.getByPlaceholderText('Find something')).toBeInTheDocument();
  });

  it('should have an accessible label', () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Search subscriptions')).toBeInTheDocument();
  });

  it('should call onChange when user types', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="" onChange={onChange} />);

    await user.type(screen.getByLabelText('Search subscriptions'), 'netflix');
    expect(onChange).toHaveBeenCalledTimes(7); // one call per character
  });

  it('should not show clear button when value is empty', () => {
    render(<SearchInput value="" onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
  });

  it('should show clear button when value is non-empty', () => {
    render(<SearchInput value="test" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('should call onChange with empty string when clear is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="test" onChange={onChange} />);

    await user.click(screen.getByLabelText('Clear search'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
