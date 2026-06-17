// Parse a free-form currency string from a CSV cell into a SIGNED integer
// number of minor units (cents). Returns null when the value can't be parsed
// unambiguously, so the caller can reject the row with a row-level error.
//
// Handles the common shapes found in bank/credit-card exports:
//   "$1,234.56" -> 123456     "1234.5"   -> 123450     "50"      -> 5000
//   "-50.00"    -> -5000       "+50"      -> 5000       "(1,234.56)" -> -123456
//   "$ (12.30)" -> -1230       ""/"abc"/"1.2.3" -> null
//
// The sign convention (negative = debit/outflow, positive = credit/inflow) is
// interpreted by the importer to choose expense vs income; this function only
// reports the signed magnitude.
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

  // A leading sign (after stripping) flips/keeps the sign.
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  // Only a plain decimal remains; anything else (letters, multiple dots) is
  // ambiguous and rejected.
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return null;
  }

  // Round to the nearest cent so float representation (e.g. 1.1 * 100) can't
  // leak a fractional cent into storage.
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}
