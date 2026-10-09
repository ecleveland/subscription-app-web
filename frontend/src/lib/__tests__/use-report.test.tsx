import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('../toast', () => ({ showErrorToast: vi.fn() }));

import { showErrorToast } from '../toast';
import { useReport, type ReportState } from '../use-report';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Snapshot = { key: string | null } & ReportState<string>;

function Probe({
  reportKey,
  load,
  log,
}: {
  reportKey: string | null;
  load: () => Promise<string>;
  log: Snapshot[];
}) {
  const state = useReport('Cash flow', reportKey, load, 'Failed to load');
  log.push({ ...state, key: reportKey });
  return <p>{state.loading ? 'loading' : (state.error ?? state.data)}</p>;
}

beforeEach(() => vi.mocked(showErrorToast).mockReset());

describe('useReport', () => {
  it('never renders the previous key data under a new key', async () => {
    const log: Snapshot[] = [];
    const { rerender } = render(
      <Probe reportKey="a" load={() => Promise.resolve('A')} log={log} />,
    );
    await screen.findByText('A');

    const next = deferred<string>();
    rerender(<Probe reportKey="b" load={() => next.promise} log={log} />);

    const stale = log.filter((s) => s.key === 'b' && s.data === 'A');
    expect(stale).toEqual([]);
    expect(log.filter((s) => s.key === 'b').every((s) => s.loading)).toBe(true);

    await act(async () => next.resolve('B'));
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('never renders the previous key error under a new key', async () => {
    const log: Snapshot[] = [];
    const { rerender } = render(
      <Probe
        reportKey="a"
        load={() => Promise.reject(new Error('boom'))}
        log={log}
      />,
    );
    await screen.findByText('boom');

    rerender(
      <Probe reportKey="b" load={() => new Promise(() => {})} log={log} />,
    );
    expect(log.filter((s) => s.key === 'b' && s.error !== null)).toEqual([]);
  });

  it('prefixes the toast with the section title and keeps the inline message', async () => {
    render(
      <Probe
        reportKey="a"
        load={() => Promise.reject(new Error('Failed to fetch'))}
        log={[]}
      />,
    );
    await screen.findByText('Failed to fetch');
    expect(showErrorToast).toHaveBeenCalledWith('Cash flow: Failed to fetch');
  });

  it('does not fetch while the key is null', async () => {
    const load = vi.fn(() => Promise.resolve('A'));
    render(<Probe reportKey={null} load={load} log={[]} />);
    await waitFor(() => expect(screen.getByText('loading')).toBeInTheDocument());
    expect(load).not.toHaveBeenCalled();
  });
});
