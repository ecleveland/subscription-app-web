import { toast } from 'sonner';
import { showErrorToast, showSuccessToast } from '../toast';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('toast utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call toast.error with the message', () => {
    showErrorToast('Something went wrong');
    expect(toast.error).toHaveBeenCalledWith('Something went wrong');
  });

  it('should call toast.success with the message', () => {
    showSuccessToast('Operation completed');
    expect(toast.success).toHaveBeenCalledWith('Operation completed');
  });
});
