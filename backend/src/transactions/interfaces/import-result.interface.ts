// Per-row failure surfaced to the caller (0-based row index + reason) so the
// import UI can show which rows were skipped and why, without aborting the
// whole batch.
export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  // Rows turned into new transactions.
  imported: number;
  // Rows skipped as duplicates of an existing (or already-in-batch) transaction.
  skipped: number;
  // Rows rejected for a bad amount/date (everything else still imports).
  errors: ImportRowError[];
}
