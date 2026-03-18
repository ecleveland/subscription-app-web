import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagInput from '../TagInput';

describe('TagInput', () => {
  it('should render existing tags', () => {
    render(<TagInput tags={['shared', 'essential']} onChange={vi.fn()} />);

    expect(screen.getByText('shared')).toBeInTheDocument();
    expect(screen.getByText('essential')).toBeInTheDocument();
  });

  it('should add a tag on Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText('Add tag'), 'newtag{Enter}');

    expect(onChange).toHaveBeenCalledWith(['newtag']);
  });

  it('should add a tag on comma', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText('Add tag'), 'newtag,');

    expect(onChange).toHaveBeenCalledWith(['newtag']);
  });

  it('should not add duplicate tags', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={['existing']} onChange={onChange} />);

    await user.type(screen.getByLabelText('Add tag'), 'existing{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should remove tag when x button is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={['shared', 'essential']} onChange={onChange} />);

    await user.click(screen.getByLabelText('Remove shared'));

    expect(onChange).toHaveBeenCalledWith(['essential']);
  });

  it('should remove last tag on Backspace when input is empty', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={['shared', 'essential']} onChange={onChange} />);

    const input = screen.getByLabelText('Add tag');
    await user.click(input);
    await user.keyboard('{Backspace}');

    expect(onChange).toHaveBeenCalledWith(['shared']);
  });

  it('should not add empty tags', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText('Add tag'), '   {Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should trim whitespace from tags', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText('Add tag'), '  spaced  {Enter}');

    expect(onChange).toHaveBeenCalledWith(['spaced']);
  });
});
