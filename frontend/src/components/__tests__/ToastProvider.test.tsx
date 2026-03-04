import { render } from '@testing-library/react';
import ToastProvider from '../ToastProvider';

vi.mock('@/lib/theme-context', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => (
    <div data-testid="toaster" data-theme={props.theme} data-position={props.position} />
  ),
}));

describe('ToastProvider', () => {
  it('should render Toaster with theme from useTheme', () => {
    const { getByTestId } = render(<ToastProvider />);
    const toaster = getByTestId('toaster');
    expect(toaster).toHaveAttribute('data-theme', 'system');
    expect(toaster).toHaveAttribute('data-position', 'top-right');
  });
});
