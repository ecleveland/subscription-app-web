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
