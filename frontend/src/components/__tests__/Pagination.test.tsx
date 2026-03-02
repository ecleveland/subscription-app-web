import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pagination from '../Pagination';

describe('Pagination', () => {
  it('should display the current page and total pages', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={() => {}} />);

    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('should disable Previous button on page 1', () => {
    render(<Pagination page={1} totalPages={3} onPageChange={() => {}} />);

    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).not.toBeDisabled();
  });

  it('should disable Next button on last page', () => {
    render(<Pagination page={3} totalPages={3} onPageChange={() => {}} />);

    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled();
  });

  it('should call onPageChange with page - 1 when Previous is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText('Previous page'));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('should call onPageChange with page + 1 when Next is clicked', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText('Next page'));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
