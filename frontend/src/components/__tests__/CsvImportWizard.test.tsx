import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/transactions', () => ({ importTransactions: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { importTransactions } from '@/lib/transactions';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import CsvImportWizard from '@/components/CsvImportWizard';
import type { Account } from '@/lib/types';

const accounts: Account[] = [
  {
    _id: 'a1',
    householdId: 'h1',
    name: 'Checking',
    type: 'checking',
    balanceCents: 100000,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  },
];

function csvFile(text: string, name = 'import.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

// A valid file with: one expense, one income, one zero-amount (error), and a
// within-batch duplicate of the first row.
const SAMPLE_CSV =
  'Date,Amount,Payee\n' +
  '2026-06-01,-42.00,Store\n' +
  '2026-06-02,100.00,Job\n' +
  '2026-06-03,0,Nothing\n' +
  '2026-06-01,-42.00,Store\n';

async function uploadAndMap(user: ReturnType<typeof userEvent.setup>, csv = SAMPLE_CSV) {
  await user.upload(screen.getByLabelText('CSV file'), csvFile(csv));
  // Auto-guess pre-fills Date/Amount/Payee; the map step is shown.
  await screen.findByRole('button', { name: 'Preview' });
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByText(/to import/);
}

describe('CsvImportWizard', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a message and no file input when there are no accounts', () => {
    render(<CsvImportWizard accounts={[]} onImported={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Create an account before importing.')).toBeInTheDocument();
    expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument();
  });

  it('rejects a file with no columns', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(screen.getByLabelText('CSV file'), csvFile(''));
    expect(await screen.findByText('That file has no columns.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('rejects a header-only file with no rows', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(screen.getByLabelText('CSV file'), csvFile('Date,Amount\n'));
    expect(await screen.findByText('That file has no rows to import.')).toBeInTheDocument();
  });

  it('advances to the mapping step with auto-guessed columns', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(screen.getByLabelText('CSV file'), csvFile(SAMPLE_CSV));
    expect(await screen.findByLabelText('Date column')).toHaveValue('Date');
    expect(screen.getByLabelText('Amount column')).toHaveValue('Amount');
    expect(screen.getByLabelText('Payee column')).toHaveValue('Payee');
  });

  it('disables Preview until both date and amount columns are mapped', async () => {
    const user = userEvent.setup();
    // Headers that the guesser can't match → required mappings start empty.
    const csv = 'When,Value,Who\n2026-06-01,-5.00,Store\n';
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(screen.getByLabelText('CSV file'), csvFile(csv));
    const preview = await screen.findByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Date column'), 'When');
    await user.selectOptions(screen.getByLabelText('Amount column'), 'Value');
    expect(preview).toBeEnabled();
  });

  it('renders derived cents, types, error and duplicate indicators in the preview', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await uploadAndMap(user);

    // Summary counts: 2 ok, 1 duplicate, 1 error.
    expect(screen.getByText('2 to import')).toBeInTheDocument();
    expect(screen.getByText('1 duplicate')).toBeInTheDocument();
    expect(screen.getByText('1 error')).toBeInTheDocument();

    // Signed cents formatting (the original + its duplicate both render -$42.00).
    expect(screen.getAllByText('-$42.00')).toHaveLength(2);
    expect(screen.getByText('+$100.00')).toBeInTheDocument();
    expect(screen.getByText('Zero amount')).toBeInTheDocument();
    expect(screen.getByText('Duplicate — will be skipped')).toBeInTheDocument();
  });

  it('commits all parsed rows and shows a success summary on a clean import', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    vi.mocked(importTransactions).mockResolvedValue({
      imported: 2,
      skipped: 1,
      errors: [],
    });
    render(
      <CsvImportWizard accounts={accounts} onImported={onImported} onCancel={vi.fn()} />,
    );
    await uploadAndMap(user);
    await user.click(screen.getByRole('button', { name: /Import 2 rows/ }));

    await waitFor(() =>
      expect(importTransactions).toHaveBeenCalledWith({
        accountId: 'a1',
        mapping: { date: 'Date', amount: 'Amount', payee: 'Payee' },
        rows: [
          { Date: '2026-06-01', Amount: '-42.00', Payee: 'Store' },
          { Date: '2026-06-02', Amount: '100.00', Payee: 'Job' },
          { Date: '2026-06-03', Amount: '0', Payee: 'Nothing' },
          { Date: '2026-06-01', Amount: '-42.00', Payee: 'Store' },
        ],
      }),
    );
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(showSuccessToast).toHaveBeenCalledWith('Imported 2, skipped 1');
    expect(await screen.findByText('Imported 2')).toBeInTheDocument();
    expect(screen.getByText('Skipped 1')).toBeInTheDocument();
  });

  it('warns (not a plain success) when some rows fail server-side', async () => {
    const user = userEvent.setup();
    vi.mocked(importTransactions).mockResolvedValue({
      imported: 2,
      skipped: 0,
      errors: [{ row: 2, message: 'Zero amount' }],
    });
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await uploadAndMap(user);
    await user.click(screen.getByRole('button', { name: /Import 2 rows/ }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Imported 2, but 1 row failed — see details below.',
      ),
    );
    expect(showSuccessToast).not.toHaveBeenCalled();
    expect(await screen.findByText('Row 3: Zero amount')).toBeInTheDocument();
  });

  it('shows an error toast (not success) when nothing was imported', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    vi.mocked(importTransactions).mockResolvedValue({
      imported: 0,
      skipped: 2,
      errors: [],
    });
    render(
      <CsvImportWizard accounts={accounts} onImported={onImported} onCancel={vi.fn()} />,
    );
    await uploadAndMap(user);
    await user.click(screen.getByRole('button', { name: /Import 2 rows/ }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Nothing imported — all 2 rows were duplicates.',
      ),
    );
    expect(showSuccessToast).not.toHaveBeenCalled();
    // Still refreshes so any concurrent change is reflected.
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Imported 0')).toBeInTheDocument();
  });

  it('closes via the Done button after a successful import', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    vi.mocked(importTransactions).mockResolvedValue({ imported: 2, skipped: 0, errors: [] });
    render(
      <CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={onCancel} />,
    );
    await uploadAndMap(user);
    await user.click(screen.getByRole('button', { name: /Import 2 rows/ }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('auto-guesses common bank-export header aliases', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(
      screen.getByLabelText('CSV file'),
      csvFile('Posted Date,Debit,Description\n2026-06-01,-5.00,Store\n'),
    );
    expect(await screen.findByLabelText('Date column')).toHaveValue('Posted Date');
    expect(screen.getByLabelText('Amount column')).toHaveValue('Debit');
    expect(screen.getByLabelText('Payee column')).toHaveValue('Description');
  });

  it('recovers after a bad file followed by a good one', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('CSV file');
    await user.upload(input, csvFile('Date,Amount\n'));
    expect(await screen.findByText('That file has no rows to import.')).toBeInTheDocument();
    await user.upload(input, csvFile(SAMPLE_CSV));
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.queryByText('That file has no rows to import.')).not.toBeInTheDocument();
  });

  it('shows a toast and stays on preview when the import request rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(importTransactions).mockRejectedValue(new Error('boom'));
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await uploadAndMap(user);
    await user.click(screen.getByRole('button', { name: /Import 2 rows/ }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('boom'));
    expect(screen.getByText('2 to import')).toBeInTheDocument();
  });

  it('disables the import button when every row is an error', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await uploadAndMap(user, 'Date,Amount,Payee\nbad,abc,X\nalso,xyz,Y\n');
    expect(screen.getByRole('button', { name: /Import 0 rows/ })).toBeDisabled();
  });

  it('rejects a file that exceeds the row cap at the upload step', async () => {
    const user = userEvent.setup();
    const lines = ['Date,Amount,Payee'];
    for (let i = 0; i < 2001; i++) lines.push(`2026-06-01,-${i + 1}.00,P${i}`);
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(screen.getByLabelText('CSV file'), csvFile(lines.join('\n') + '\n'));
    expect(await screen.findByText(/the maximum is 2000/)).toBeInTheDocument();
    // Never advances to the mapping step.
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('surfaces a toast when the file cannot be read', async () => {
    const user = userEvent.setup();
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    // A File-like whose text/stream FileReader can't consume: stub FileReader.
    const OriginalFileReader = globalThis.FileReader;
    class FailingFileReader {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      error = new Error('read failed');
      readAsText() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingFileReader);
    await user.upload(screen.getByLabelText('CSV file'), csvFile(SAMPLE_CSV));
    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('Could not read that file.'),
    );
    expect(screen.getByText('Could not read that file.')).toBeInTheDocument();
    vi.stubGlobal('FileReader', OriginalFileReader);
  });

  it('omits empty optional mapping fields from the request', async () => {
    const user = userEvent.setup();
    vi.mocked(importTransactions).mockResolvedValue({ imported: 1, skipped: 0, errors: [] });
    render(<CsvImportWizard accounts={accounts} onImported={vi.fn()} onCancel={vi.fn()} />);
    await user.upload(
      screen.getByLabelText('CSV file'),
      csvFile('Date,Amount\n2026-06-01,-5.00\n'),
    );
    await screen.findByRole('button', { name: 'Preview' });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(await screen.findByRole('button', { name: /Import 1 row/ }));
    await waitFor(() => {
      const arg = vi.mocked(importTransactions).mock.calls[0][0];
      expect(arg.mapping).toEqual({ date: 'Date', amount: 'Amount' });
    });
  });
});
