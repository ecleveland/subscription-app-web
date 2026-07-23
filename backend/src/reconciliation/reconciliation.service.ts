import { Injectable, Logger } from '@nestjs/common';
import { AccountsService } from '../accounts/accounts.service';
import { TransactionsService } from '../transactions/transactions.service';
import type {
  AccountReconcileResult,
  ReconciliationSummary,
} from './interfaces/reconciliation-report.interface';

export interface ReconcileOptions {
  // Scope the run to a single household; omit for a cross-household sweep.
  householdId?: string;
  // Report drift without writing any correction (an ops safety valve, useful on
  // the first run against legacy data whose pre-existing drift the anchor bakes
  // in — see backfillOpeningBalances).
  dryRun?: boolean;
}

/**
 * Balance reconciliation (VEG-478). Re-derives each account's cached
 * `balanceCents` as `openingBalanceCents + Σ(ledger deltas)` and corrects any
 * drift left behind when the recurring scheduler inserted a ledger row but died
 * before its balance `$inc` landed (the ledger is source-of-truth; the balance
 * is a re-derivable cache). Reads the ledger via TransactionsService (owns the
 * Transaction model) and writes via AccountsService (owns the Account model);
 * this service only orchestrates.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly accountsService: AccountsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * Reconcile every account (optionally scoped to one household). Each
   * correction is a compare-and-set on the balance snapshot, so a legitimate
   * write racing in AFTER the snapshot causes a CAS miss (reported
   * `skipped-concurrent`, healed next run) rather than a clobbered balance.
   *
   * This is safe against concurrency for the common case but not atomically so:
   * the write path persists the ledger row before its balance `$inc` (no
   * multi-document transactions in this codebase, by design), so in the narrow
   * window where a write's row is already visible to the aggregation but its
   * `$inc` has not yet landed, a CAS can match and briefly double-apply. The
   * operating assumption is therefore that reconciliation runs during a quiet
   * period — the weekly sweep fires off-peak, and an ops-triggered run should be
   * timed likewise. This is the same accepted trade-off the rest of the balance
   * subsystem already makes; reconciliation narrows drift, it doesn't replace the
   * transactionality the codebase deliberately forgoes.
   */
  async reconcile(
    options: ReconcileOptions = {},
  ): Promise<ReconciliationSummary> {
    const { householdId, dryRun = false } = options;

    const accounts = await this.accountsService.findForReconcile(householdId);
    const deltas =
      await this.transactionsService.sumLedgerDeltasByAccount(householdId);

    const results: AccountReconcileResult[] = [];
    const households = new Set<string>();

    for (const account of accounts) {
      households.add(account.householdId);

      // An account still missing its opening-balance anchor (a partial boot
      // backfill is caught-and-continue, so this is possible) cannot be
      // reconciled: `openingBalanceCents + delta` would be NaN. Defaulting the
      // anchor to 0 would be worse than skipping — it would "correct" the
      // balance to Σ(ledger) and WIPE the real opening balance, the exact
      // failure this whole design exists to prevent. Record it as a first-class
      // `skipped-no-anchor` result (so it shows in the audit report and the
      // counters, not just a stray log line) and move on; the next boot backfill
      // stamps the anchor and the following run reconciles it.
      const opening = account.openingBalanceCents;
      if (opening === undefined || !Number.isInteger(opening)) {
        this.logger.warn(
          { householdId: account.householdId, accountId: account.id },
          'Skipping account with no opening-balance anchor; run backfill first',
        );
        results.push({
          accountId: account.id,
          householdId: account.householdId,
          name: account.name,
          previousBalanceCents: account.balanceCents,
          computedBalanceCents: account.balanceCents,
          driftCents: 0,
          status: 'skipped-no-anchor',
        });
        continue;
      }

      const computed = opening + (deltas.get(account.id) ?? 0);
      const previous = account.balanceCents;
      const driftCents = computed - previous;

      let status: AccountReconcileResult['status'];
      if (driftCents === 0) {
        status = 'clean';
      } else if (dryRun) {
        status = 'drifted';
      } else {
        const landed = await this.accountsService.compareAndSetBalance(
          account.householdId,
          account.id,
          previous,
          computed,
        );
        status = landed ? 'corrected' : 'skipped-concurrent';
      }

      results.push({
        accountId: account.id,
        householdId: account.householdId,
        name: account.name,
        previousBalanceCents: previous,
        computedBalanceCents: computed,
        driftCents,
        status,
      });
    }

    const summary: ReconciliationSummary = {
      dryRun,
      householdsScanned: households.size,
      accountsScanned: results.length,
      corrected: results.filter((r) => r.status === 'corrected').length,
      skippedConcurrent: results.filter(
        (r) => r.status === 'skipped-concurrent',
      ).length,
      drifted: results.filter((r) => r.status === 'drifted').length,
      skippedNoAnchor: results.filter((r) => r.status === 'skipped-no-anchor')
        .length,
      totalDriftCents: results
        .filter((r) => r.status !== 'clean')
        .reduce((sum, r) => sum + Math.abs(r.driftCents), 0),
      results,
    };

    // Escalate the run-level verdict so an operator filtering the summary to
    // warn+ sees when anything needed attention: drift corrected or detected
    // (dry run), a concurrent-write race that will heal next run, or — most
    // importantly — accounts that could not be reconciled at all because a boot
    // backfill left them without an anchor.
    const needsAttention =
      summary.corrected > 0 ||
      summary.drifted > 0 ||
      summary.skippedConcurrent > 0 ||
      summary.skippedNoAnchor > 0;
    const level = needsAttention ? 'warn' : 'log';
    this.logger[level](
      {
        householdId: householdId ?? 'all',
        dryRun,
        accountsScanned: summary.accountsScanned,
        corrected: summary.corrected,
        skippedConcurrent: summary.skippedConcurrent,
        drifted: summary.drifted,
        skippedNoAnchor: summary.skippedNoAnchor,
        totalDriftCents: summary.totalDriftCents,
      },
      'Balance reconciliation complete',
    );

    return summary;
  }

  /**
   * One-time idempotent stamp of `openingBalanceCents` on legacy accounts that
   * predate the anchor. The true original opening balance was never persisted,
   * so the only recoverable anchor is `balanceCents − Σ(ledger)` — which trusts
   * the current cache. This bakes any drift ALREADY present at boot into the
   * anchor (treated thereafter as legitimate); accepted because drift is new and
   * rare, and every FUTURE dropped `$inc` is still caught correctly once the
   * anchor is fixed. Runs at boot before traffic; a re-run stamps nothing.
   */
  async backfillOpeningBalances(): Promise<number> {
    const legacy =
      await this.accountsService.findAccountsMissingOpeningBalance();
    if (legacy.length === 0) {
      return 0;
    }

    const deltas = await this.transactionsService.sumLedgerDeltasByAccount();

    let stamped = 0;
    let failed = 0;
    try {
      for (const account of legacy) {
        // Isolate each account: a transient write failure on one must not
        // abandon the rest (and leave them unanchored → unreconcilable). Log and
        // press on, counting failures so the progress line reflects reality.
        try {
          const opening = account.balanceCents - (deltas.get(account.id) ?? 0);
          const didStamp = await this.accountsService.setOpeningBalanceIfUnset(
            account.id,
            opening,
          );
          if (didStamp) {
            stamped += 1;
          }
        } catch (error: unknown) {
          failed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            { householdId: account.householdId, accountId: account.id },
            `Failed to stamp openingBalanceCents; account left unanchored: ${message}`,
          );
        }
      }
    } finally {
      // Always report progress — even if the loop is cut short — so a partial
      // backfill is visible rather than silently swallowed by the boot handler.
      this.logger[failed > 0 ? 'error' : 'log'](
        { candidates: legacy.length, stamped, failed },
        'Backfilled openingBalanceCents on legacy accounts',
      );
    }
    return stamped;
  }
}
