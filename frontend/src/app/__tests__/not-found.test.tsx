import { render, screen } from '@testing-library/react';
import NotFound from '../not-found';

describe('NotFound page', () => {
  it('should render the 404 heading', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('should render the "Page not found" message', () => {
    render(<NotFound />);
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('should have a link back to the dashboard', () => {
    render(<NotFound />);
    const link = screen.getByRole('link', { name: /back to dashboard/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });
});
