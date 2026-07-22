// The per-account outcome of a balance reconciliation run (VEG-478).
//
// `driftCents` is signed as `computed − previous`: a positive value means the
// cached balance was SHORT (the exact dropped-`$inc` failure the scheduler can
// produce), negative means it was long. `status` records what was done:
//   - `clean`             — no drift; the account was left untouched.
//   - `corrected`         — drift found and the cached balance was rewritten.
//   - `skipped-concurrent`— drift found, but a compare-and-set miss means a
//                           legitimate write raced in; deferred to the next run
//                           rather than clobbering it.
//   - `drifted`           — drift found in a dry run; reported but not written.
//   - `skipped-no-anchor` — the account has no openingBalanceCents anchor yet
//                           (a partial boot backfill), so it cannot be
//                           reconciled without wiping its opening balance. Left
//                           untouched; the next boot backfill stamps the anchor.
export type AccountReconcileStatus =
  | 'clean'
  | 'corrected'
  | 'skipped-concurrent'
  | 'drifted'
  | 'skipped-no-anchor';

export interface AccountReconcileResult {
  accountId: string;
  householdId: string;
  name: string;
  previousBalanceCents: number;
  computedBalanceCents: number;
  driftCents: number;
  status: AccountReconcileStatus;
}

// The auditable summary of a whole run. Counters make drift obvious at a glance;
// `results` carries every account scanned (including clean ones) so a run is
// fully inspectable.
export interface ReconciliationSummary {
  dryRun: boolean;
  householdsScanned: number;
  accountsScanned: number;
  corrected: number;
  skippedConcurrent: number;
  drifted: number;
  // Accounts that could not be reconciled because they still lack the opening
  // balance anchor. A nonzero count means a boot backfill did not complete and
  // is escalated in the run's log level so it is not silently healthy-looking.
  skippedNoAnchor: number;
  totalDriftCents: number;
  results: AccountReconcileResult[];
}
