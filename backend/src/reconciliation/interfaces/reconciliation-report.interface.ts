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
export type AccountReconcileStatus =
  | 'clean'
  | 'corrected'
  | 'skipped-concurrent'
  | 'drifted';

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
  totalDriftCents: number;
  results: AccountReconcileResult[];
}
