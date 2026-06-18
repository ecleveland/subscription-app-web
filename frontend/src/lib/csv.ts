const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parse CSV text into headers + row objects (keyed by header) for the
 * transaction import flow. Handles quoted fields, commas and newlines inside
 * quotes, escaped quotes (""), and CRLF/LF line endings. The first non-empty
 * line is treated as the header row. Rows with more/fewer cells than headers are
 * tolerated (extra cells dropped, missing cells empty); the column-mapping UI
 * (VEG-401) decides which columns matter.
 */
export function parseCsv(text: string): ParsedCsv {
  const records = parseRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? '';
    });
    return row;
  });
  return { headers, rows };
}

// Tokenize CSV text into an array of records (each a list of cell strings),
// respecting RFC-4180-style quoting. Fully-blank lines are dropped.
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.some((c) => c.trim() !== '')) {
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRecord();
    } else if (char !== '\r') {
      field += char;
    }
  }
  // Flush the trailing record if the file didn't end with a newline.
  if (field !== '' || record.length > 0) {
    pushRecord();
  }
  return records;
}

// --- CSV import derivation (preview mirror of the backend) ------------------
// These mirror backend/src/transactions/{csv-import.util.ts, transactions.service
// .ts} so the import preview shows exactly what the server will do. Keep the two
// in lockstep — the shared example matrix in csv.test.ts / csv-import.util.spec.ts
// guards against drift. Cross-account/DB dedupe is the server's job and only
// surfaces in the import result's `skipped` count; here we only flag duplicates
// *within the uploaded batch*.

/**
 * Parse a free-form currency string into a SIGNED integer number of cents, or
 * null when it can't be parsed unambiguously. Port of the backend
 * `parseAmountToCents` (negative = outflow/expense, positive = inflow/income).
 */
export function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let s = raw.trim();
  if (!s) {
    return null;
  }

  // Strip currency symbols and whitespace first so a leading "$ " can't hide the
  // accounting-style parentheses that denote a negative amount.
  s = s.replace(/[$\s]/g, '');

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip thousands separators.
  s = s.replace(/,/g, '');

  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    return null;
  }

  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

/** Which CSV column header supplies each logical field (matches the backend DTO). */
export interface ColumnMapping {
  date: string;
  amount: string;
  payee?: string;
  category?: string;
}

export type DerivedRowStatus = 'ok' | 'duplicate' | 'error';

export interface DerivedRow {
  /** Position in the parsed-rows array (lines up with backend `errors[].row`). */
  index: number;
  status: DerivedRowStatus;
  /** Present unless status is 'error'. */
  type?: 'income' | 'expense';
  amountCents?: number;
  dateMs?: number;
  payee?: string;
  /** The raw category cell value (the server resolves it by name). */
  category?: string;
  /** Present when status is 'error'. */
  error?: string;
  raw: Record<string, string>;
}

/**
 * Derive a preview row for each parsed CSV row using the chosen column mapping,
 * mirroring the backend's import logic: amount → signed cents (sign → expense/
 * income), with row-level errors for unparseable/zero amounts and bad dates, and
 * within-batch duplicate detection on date+amount+type+payee.
 */
export function deriveImportRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): DerivedRow[] {
  const seen = new Set<string>();
  return rows.map((raw, index) => {
    const cents = parseAmountToCents(raw[mapping.amount]);
    if (cents === null) {
      return { index, status: 'error', error: 'Unparseable amount', raw };
    }
    if (cents === 0) {
      return { index, status: 'error', error: 'Zero amount', raw };
    }
    const date = new Date(raw[mapping.date]);
    if (Number.isNaN(date.getTime())) {
      return { index, status: 'error', error: 'Unparseable date', raw };
    }

    const type = cents < 0 ? 'expense' : 'income';
    const amountCents = Math.abs(cents);
    const payee = mapping.payee ? raw[mapping.payee]?.trim() || undefined : undefined;
    const category = mapping.category ? raw[mapping.category]?.trim() || undefined : undefined;

    const key = `${date.getTime()}|${amountCents}|${type}|${payee ?? ''}`;
    const status: DerivedRowStatus = seen.has(key) ? 'duplicate' : 'ok';
    seen.add(key);

    return {
      index,
      status,
      type,
      amountCents,
      dateMs: date.getTime(),
      payee,
      category,
      raw,
    };
  });
}

export async function downloadSubscriptionsCsv(
  queryParams: string,
): Promise<void> {
  const token = localStorage.getItem('token');
  const res = await fetch(
    `${API_URL}/subscriptions/export${queryParams ? `?${queryParams}` : ''}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Export failed: ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'subscriptions.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
