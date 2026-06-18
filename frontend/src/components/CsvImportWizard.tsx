'use client';

import { useMemo, useState } from 'react';
import {
  parseCsv,
  deriveImportRows,
  type ColumnMapping,
  type DerivedRow,
} from '@/lib/csv';
import { importTransactions } from '@/lib/transactions';
import { formatCents, formatDate } from '@/lib/utils';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { Account, ImportResult } from '@/lib/types';

// Mirrors the backend's ArrayMaxSize(2000) so we block the import before a
// guaranteed 400 rather than after a round-trip.
const MAX_IMPORT_ROWS = 2000;

type Step = 'upload' | 'map' | 'preview' | 'result';

interface Props {
  accounts: Account[];
  /** Called after a successful import so the page can refresh ledger + balances. */
  onImported: () => void;
  onCancel: () => void;
}

// Case-insensitive best-guess of which header feeds each field, so common bank
// exports land on the mapping step pre-filled.
function guessMapping(headers: string[]): ColumnMapping {
  const find = (...names: string[]) =>
    headers.find((h) => names.includes(h.trim().toLowerCase())) ?? '';
  return {
    date: find('date', 'transaction date', 'posted date'),
    amount: find('amount', 'value', 'debit'),
    payee: find('payee', 'description', 'name', 'merchant'),
    category: find('category'),
  };
}

// Read a File as text via FileReader (more reliable than Blob.text() across the
// jsdom/Playwright upload paths we test against).
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700';

export default function CsvImportWizard({ accounts, onImported, onCancel }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [accountId, setAccountId] = useState(accounts[0]?._id ?? '');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', amount: '' });
  const [fileError, setFileError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const derived = useMemo(
    () => (mapping.date && mapping.amount ? deriveImportRows(rows, mapping) : []),
    [rows, mapping],
  );
  const summary = useMemo(() => {
    let ok = 0;
    let duplicate = 0;
    let error = 0;
    for (const d of derived) {
      if (d.status === 'ok') ok += 1;
      else if (d.status === 'duplicate') duplicate += 1;
      else error += 1;
    }
    return { ok, duplicate, error, total: derived.length };
  }, [derived]);

  const canProceedFromMap = !!mapping.date && !!mapping.amount;
  const canCommit = summary.ok > 0 && !submitting;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setFileError('');
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      setFileError('Could not read that file.');
      showErrorToast('Could not read that file.');
      return;
    }
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) {
      setFileError('That file has no columns.');
      return;
    }
    if (parsed.rows.length === 0) {
      setFileError('That file has no rows to import.');
      return;
    }
    // Reject oversized files up front — before deriving/rendering thousands of
    // rows — rather than letting the preview build them and then disabling
    // commit. Mirrors the backend's ArrayMaxSize(2000).
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      setFileError(
        `That file has ${parsed.rows.length} rows; the maximum is ${MAX_IMPORT_ROWS}. ` +
          `Split it and import in batches.`,
      );
      return;
    }
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(guessMapping(parsed.headers));
    setStep('map');
  }

  // Drop empty optional mapping keys so the DTO's @IsOptional() is satisfied.
  function cleanMapping(): ColumnMapping {
    const m: ColumnMapping = { date: mapping.date, amount: mapping.amount };
    if (mapping.payee) m.payee = mapping.payee;
    if (mapping.category) m.category = mapping.category;
    return m;
  }

  async function handleCommit() {
    setSubmitting(true);
    try {
      // Send all parsed rows — the backend re-derives and dedupes
      // authoritatively (including against already-stored transactions).
      const res = await importTransactions({
        accountId,
        mapping: cleanMapping(),
        rows,
      });
      setResult(res);
      setStep('result');
      // The backend dedupes against stored transactions and can reject rows we
      // couldn't see in the preview, so it may import fewer than `summary.ok`
      // (even zero). Keep the toast honest rather than always green.
      const plural = (n: number) => `${n} row${n === 1 ? '' : 's'}`;
      if (res.imported === 0) {
        showErrorToast(
          res.errors.length > 0
            ? `Nothing imported — ${plural(res.errors.length)} failed, ${res.skipped} skipped.`
            : `Nothing imported — all ${plural(res.skipped)} were duplicates.`,
        );
      } else if (res.errors.length > 0) {
        showErrorToast(
          `Imported ${res.imported}, but ${plural(res.errors.length)} failed — see details below.`,
        );
      } else {
        showSuccessToast(`Imported ${res.imported}, skipped ${res.skipped}`);
      }
      onImported();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  function signedAmount(d: DerivedRow): string {
    const formatted = formatCents(d.amountCents ?? 0);
    return d.type === 'expense' ? `-${formatted}` : `+${formatted}`;
  }

  const wrapperClass =
    'space-y-4 max-w-2xl border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800';

  if (accounts.length === 0) {
    return (
      <div className={wrapperClass}>
        <h2 className="text-lg font-semibold">Import transactions from CSV</h2>
        <p className="text-sm text-gray-500">Create an account before importing.</p>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <h2 className="text-lg font-semibold">Import transactions from CSV</h2>

      {step === 'upload' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="import-account" className="block text-sm font-medium mb-1">
              Target account
            </label>
            <select
              id="import-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={selectClass}
            >
              {accounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="import-file" className="block text-sm font-medium mb-1">
              CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Clear the input so re-selecting the same file (e.g. after a
                // parse error or going Back) still fires onChange.
                e.target.value = '';
                handleFile(file);
              }}
              className="block text-sm"
            />
          </div>
          {fileError && <p className="text-red-500 text-sm">{fileError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Mapping columns from <span className="font-medium">{fileName}</span> (
            {rows.length} rows).
          </p>
          {(
            [
              ['date', 'Date column', true],
              ['amount', 'Amount column', true],
              ['payee', 'Payee column', false],
              ['category', 'Category column', false],
            ] as const
          ).map(([field, label, required]) => (
            <div key={field}>
              <label htmlFor={`map-${field}`} className="block text-sm font-medium mb-1">
                {label}
              </label>
              <select
                id={`map-${field}`}
                value={mapping[field] ?? ''}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, [field]: e.target.value }))
                }
                className={selectClass}
              >
                {!required && <option value="">— none —</option>}
                {required && <option value="">Select a column…</option>}
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!canProceedFromMap}
              onClick={() => setStep('preview')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-medium text-green-600">{summary.ok} to import</span>
            {' · '}
            <span className="text-gray-500">{summary.duplicate} duplicate</span>
            {' · '}
            <span className="text-red-600">{summary.error} error{summary.error === 1 ? '' : 's'}</span>
          </p>
          <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
            {derived.map((d) => (
              <li
                key={d.index}
                className={`flex items-center justify-between px-3 py-2 text-sm ${
                  d.status === 'error'
                    ? 'bg-red-50 dark:bg-red-950/30'
                    : d.status === 'duplicate'
                      ? 'opacity-60'
                      : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate">
                    {d.status === 'error'
                      ? d.raw[mapping.date] || d.raw[mapping.amount] || `Row ${d.index + 1}`
                      : `${formatDate(new Date(d.dateMs ?? 0))}${d.payee ? ` · ${d.payee}` : ''}`}
                  </p>
                  {d.status === 'error' && (
                    <p className="text-xs text-red-600">{d.error}</p>
                  )}
                  {d.status === 'duplicate' && (
                    <p className="text-xs text-gray-500">Duplicate — will be skipped</p>
                  )}
                </div>
                {d.status !== 'error' && (
                  <span
                    className={
                      d.type === 'expense'
                        ? 'font-semibold text-red-600'
                        : 'font-semibold text-green-600'
                    }
                  >
                    {signedAmount(d)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!canCommit}
              onClick={handleCommit}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Importing…' : `Import ${summary.ok} row${summary.ok === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={() => setStep('map')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-4">
          <p className="text-sm">
            <span
              className={
                result.imported > 0
                  ? 'font-medium text-green-600'
                  : 'font-medium text-gray-500'
              }
            >
              Imported {result.imported}
            </span>
            {' · '}
            <span className="text-gray-500">Skipped {result.skipped}</span>
            {result.errors.length > 0 && (
              <>
                {' · '}
                <span className="text-red-600">{result.errors.length} error{result.errors.length === 1 ? '' : 's'}</span>
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-48 overflow-y-auto text-sm text-red-600 list-disc pl-5">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.row >= 0 ? `Row ${e.row + 1}: ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
