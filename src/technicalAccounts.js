/**
 * Technical accounts are the periodic statement of a treaty: ceded premium,
 * ceded losses, commission, and other charges for one period, with a balance
 * that is due to or from the reinsurer.
 *
 * This module owns the wire shape the workbench sends, plus the small amount of
 * arithmetic the browser needs for the balance preview and summary cards. The
 * domain service remains authoritative for the stored balance; the browser only
 * previews the same formula.
 */

/** Four decimal places, matching the domain's numeric(19,4) money columns. */
const SCALE = 10000;

const PERIOD_FROM_KEYS = ['periodStart', 'periodFrom', 'accountPeriodFrom'];
const PERIOD_TO_KEYS = ['periodEnd', 'periodTo', 'accountPeriodTo'];
const PREMIUM_KEYS = ['cededPremium', 'cededPremiumAmount'];
const LOSS_KEYS = ['cededLosses', 'cededLossAmount', 'cededLossesAmount', 'paidLossAmount'];
const COMMISSION_KEYS = ['commission', 'commissionAmount', 'cedingCommissionAmount'];
const OTHER_CHARGE_KEYS = ['otherCharges', 'otherChargesAmount'];
const BALANCE_KEYS = ['balance', 'balanceAmount'];
const ACCOUNT_NUMBER_KEYS = ['accountNumber', 'technicalAccountNumber', 'number'];
const ACCOUNT_ID_KEYS = ['accountId', 'id', 'technicalAccountId'];

export const TECHNICAL_ACCOUNT_STATUS = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  SETTLED: 'SETTLED'
};

export function technicalAccountsEndpoint(contractId) {
  return `/api/v1/contracts/${contractId}/technical-accounts`;
}

export function technicalAccountStatusEndpoint(contractId, accountId) {
  return `${technicalAccountsEndpoint(contractId)}/${accountId}/status`;
}

function pick(row, keys) {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

export function accountNumber(row) {
  const value = pick(row, ACCOUNT_NUMBER_KEYS);
  return value === undefined ? '' : String(value);
}

export function accountId(row) {
  const value = pick(row, ACCOUNT_ID_KEYS);
  return value === undefined ? '' : String(value);
}

export function accountPeriodFrom(row) {
  const value = pick(row, PERIOD_FROM_KEYS);
  return value === undefined ? '' : String(value);
}

export function accountPeriodTo(row) {
  const value = pick(row, PERIOD_TO_KEYS);
  return value === undefined ? '' : String(value);
}

export function accountCurrency(row) {
  const value = pick(row, ['currency']);
  return value === undefined ? '' : String(value).toUpperCase();
}

export function accountCededPremium(row) {
  return pick(row, PREMIUM_KEYS);
}

export function accountCededLosses(row) {
  return pick(row, LOSS_KEYS);
}

export function accountCommission(row) {
  return pick(row, COMMISSION_KEYS);
}

export function accountOtherCharges(row) {
  return pick(row, OTHER_CHARGE_KEYS);
}

export function accountStatus(row) {
  const value = pick(row, ['status']);
  return value === undefined ? '' : String(value).toUpperCase();
}

/**
 * Converts a decimal amount to integer ten-thousandths so previews and summaries
 * add exactly. Returns 0 for blank or non-numeric input; callers validate before
 * they send anything to the domain service.
 */
export function amountUnits(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * SCALE) : 0;
}

/** Renders integer ten-thousandths as a 4-dp decimal string. */
export function unitsToAmount(units) {
  return (units / SCALE).toFixed(4);
}

/**
 * Balance preview: ceded premium is due to the reinsurer; ceded losses and the
 * ceding commission are deducted, and other charges are added back. A positive
 * balance is due to the reinsurer and a negative balance is due to the cedent.
 * This mirrors the domain rule (CTR-08): premium - losses - commission + charges.
 */
export function computeBalance({ cededPremium, cededLosses, commission, otherCharges }) {
  const units = amountUnits(cededPremium)
    - amountUnits(cededLosses)
    - amountUnits(commission)
    + amountUnits(otherCharges);
  return unitsToAmount(units);
}

export function balancePreview(form) {
  return computeBalance({
    cededPremium: form.cededPremiumAmount,
    cededLosses: form.cededLossAmount,
    commission: form.commissionAmount,
    otherCharges: form.otherChargesAmount
  });
}

/**
 * Uses the balance the domain service reports. Older or partial payloads that
 * omit it fall back to the same formula so the statement still reconciles.
 */
export function accountBalance(row) {
  const stored = pick(row, BALANCE_KEYS);
  if (stored !== undefined) {
    return stored;
  }
  return computeBalance({
    cededPremium: accountCededPremium(row),
    cededLosses: accountCededLosses(row),
    commission: accountCommission(row),
    otherCharges: accountOtherCharges(row)
  });
}

export function formatAmount(value, currency) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return String(value);
  }
  const code = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`.trim();
  }
}

export function formatPeriod(row) {
  const from = accountPeriodFrom(row) || '—';
  const to = accountPeriodTo(row) || '—';
  return `${from} → ${to}`;
}

function dateKey(value) {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : String(value);
}

function newestKeyFirst(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.localeCompare(left);
}

/**
 * Newest period first. The period end is the statement date, so it leads; the
 * period start and then the account number break ties deterministically even if
 * the service returns the rows in insertion order.
 */
export function sortTechnicalAccounts(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byEnd = newestKeyFirst(dateKey(accountPeriodTo(left)), dateKey(accountPeriodTo(right)));
    if (byEnd !== 0) return byEnd;
    const byStart = newestKeyFirst(dateKey(accountPeriodFrom(left)), dateKey(accountPeriodFrom(right)));
    if (byStart !== 0) return byStart;
    return newestKeyFirst(accountNumber(left), accountNumber(right));
  });
}

export function statusTone(status) {
  switch (status) {
    case 'SETTLED':
      return 'green';
    case 'ISSUED':
      return 'blue';
    case 'DRAFT':
      return 'amber';
    case 'DISPUTED':
      return 'red';
    default:
      return 'blue';
  }
}

/**
 * The single lifecycle action a statement exposes: a DRAFT can be issued and an
 * ISSUED statement can be settled. Agreed, disputed, superseded, and settled
 * statements have no action here.
 */
export function nextAction(row) {
  const status = accountStatus(row);
  if (status === TECHNICAL_ACCOUNT_STATUS.DRAFT) {
    return { status: TECHNICAL_ACCOUNT_STATUS.ISSUED, label: 'Issue', verb: 'issued' };
  }
  if (status === TECHNICAL_ACCOUNT_STATUS.ISSUED) {
    return { status: TECHNICAL_ACCOUNT_STATUS.SETTLED, label: 'Settle', verb: 'settled' };
  }
  return null;
}

export function statusPayload(status) {
  return { status };
}

/* ------------------------------------------------------------------------- *
 * Statement lines
 *
 * A technical account is the header of the period statement: ceded premium,
 * ceded losses, commission, other charges, and the derived balance. Its lines
 * itemise those amounts by type. The service reduces the line domain to the
 * four header components, so each line type rolls into exactly one of them:
 *
 *   PREMIUM     -> ceded premium
 *   LOSS        -> ceded losses
 *   COMMISSION  -> commission
 *   OTHER       -> other charges
 *
 * Line amounts are strictly positive magnitudes, matching the domain's money
 * validation. The balance comparison applies the same sign convention as the
 * header: premium + other charges - losses - commission.
 * ------------------------------------------------------------------------- */

export const TECHNICAL_ACCOUNT_LINE_TYPES = [
  'PREMIUM',
  'LOSS',
  'COMMISSION',
  'OTHER'
];

export const TECHNICAL_ACCOUNT_LINE_TYPE_LABELS = {
  PREMIUM: 'Premium',
  LOSS: 'Loss',
  COMMISSION: 'Commission',
  OTHER: 'Other charges',
  BROKERAGE: 'Brokerage',
  PAID_LOSS: 'Paid loss',
  OUTSTANDING_LOSS: 'Outstanding loss',
  IBNR: 'IBNR',
  ALAE: 'ALAE',
  REINSTATEMENT: 'Reinstatement',
  CASH_CALL: 'Cash call',
  FUNDS_WITHHELD: 'Funds withheld',
  TAX: 'Tax',
  ADJUSTMENT: 'Adjustment'
};

export const TECHNICAL_ACCOUNT_LINE_COMPONENT = {
  PREMIUM: 'premium',
  LOSS: 'losses',
  COMMISSION: 'commission',
  OTHER: 'otherCharges',
  // SPEC detail types remain readable when an older or richer projection emits
  // them; every one still rolls into exactly one header component.
  BROKERAGE: 'otherCharges',
  PAID_LOSS: 'losses',
  OUTSTANDING_LOSS: 'losses',
  IBNR: 'losses',
  ALAE: 'losses',
  REINSTATEMENT: 'otherCharges',
  CASH_CALL: 'otherCharges',
  FUNDS_WITHHELD: 'otherCharges',
  TAX: 'otherCharges',
  ADJUSTMENT: 'otherCharges'
};

export const LINE_COMPONENT_LABELS = {
  premium: 'Ceded premium',
  losses: 'Ceded losses',
  commission: 'Commission',
  otherCharges: 'Other charges',
  balance: 'Balance'
};

/** CTR-08 tolerance: the balance and header must reconcile to within 0.01. */
export const LINE_RECONCILIATION_TOLERANCE = 0.01;

const LINE_TOLERANCE_UNITS = Math.round(LINE_RECONCILIATION_TOLERANCE * SCALE);

const LINE_ID_KEYS = ['id', 'lineId', 'technicalAccountLineId'];
const LINE_TYPE_KEYS = ['lineType', 'type'];
const LINE_REFERENCE_KEYS = ['reference', 'sourceRef', 'source_ref', 'lineReference', 'externalRef'];
const LINE_DESCRIPTION_KEYS = ['description', 'lineDescription', 'narrative'];
const LINE_AMOUNT_KEYS = ['amount', 'lineAmount', 'amountValue'];

export function technicalAccountLinesEndpoint(contractId, accountId) {
  return `${technicalAccountsEndpoint(contractId)}/${accountId}/lines`;
}

export function technicalAccountLineEndpoint(contractId, accountId, lineId) {
  return `${technicalAccountLinesEndpoint(contractId, accountId)}/${lineId}`;
}

export function lineId(row) {
  const value = pick(row, LINE_ID_KEYS);
  return value === undefined ? '' : String(value);
}

export function lineType(row) {
  const value = pick(row, LINE_TYPE_KEYS);
  return value === undefined ? '' : String(value).toUpperCase();
}

export function lineReference(row) {
  const value = pick(row, LINE_REFERENCE_KEYS);
  return value === undefined ? '' : String(value);
}

export function lineDescription(row) {
  const value = pick(row, LINE_DESCRIPTION_KEYS);
  return value === undefined ? '' : String(value);
}

export function lineAmount(row) {
  return pick(row, LINE_AMOUNT_KEYS);
}

export function lineTypeLabel(type) {
  const key = String(type || '').toUpperCase();
  return TECHNICAL_ACCOUNT_LINE_TYPE_LABELS[key]
    || key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

/** The header component a line type rolls into; unknown types fall to charges. */
export function lineComponent(type) {
  return TECHNICAL_ACCOUNT_LINE_COMPONENT[String(type || '').toUpperCase()] || 'otherCharges';
}

/** Accepts a bare array or an `{ items }` / `{ lines }` page from the service. */
export function lineRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  if (payload && Array.isArray(payload.lines)) {
    return payload.lines;
  }
  return [];
}

/**
 * One row per line type present, in the canonical type order, with the amount,
 * transaction count, and header component the type rolls into.
 */
export function summarizeLineTypes(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const grouped = new Map();
  for (const line of list) {
    const type = lineType(line) || 'UNKNOWN';
    const units = amountUnits(lineAmount(line));
    const current = grouped.get(type) || {
      type,
      label: lineTypeLabel(type),
      component: lineComponent(type),
      units: 0,
      count: 0
    };
    current.units += units;
    current.count += 1;
    grouped.set(type, current);
  }
  const order = (type) => {
    const index = TECHNICAL_ACCOUNT_LINE_TYPES.indexOf(type);
    return index === -1 ? TECHNICAL_ACCOUNT_LINE_TYPES.length : index;
  };
  return [...grouped.values()]
    .sort((left, right) => order(left.type) - order(right.type)
      || left.type.localeCompare(right.type))
    .map((row) => ({
      type: row.type,
      label: row.label,
      component: row.component,
      count: row.count,
      amount: unitsToAmount(row.units),
      units: row.units
    }));
}

export function lineTotals(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const totals = { premium: 0, losses: 0, commission: 0, otherCharges: 0 };
  for (const line of list) {
    totals[lineComponent(lineType(line))] += amountUnits(lineAmount(line));
  }
  return totals;
}

function signedLineBalance(totals) {
  return totals.premium + totals.otherCharges - totals.losses - totals.commission;
}

/**
 * Compares the statement header with the lines grouped by type. The service is
 * still authoritative on issue (it returns `ACCOUNT_LINES_DO_NOT_RECONCILE`), but
 * the browser shows the same arithmetic so a user can see the difference before
 * they try to issue a draft.
 */
export function reconcileAccountLines(account, lines) {
  const list = Array.isArray(lines) ? lines : [];
  const totals = lineTotals(list);
  const lineBalance = signedLineBalance(totals);
  const header = {
    premium: amountUnits(accountCededPremium(account)),
    losses: amountUnits(accountCededLosses(account)),
    commission: amountUnits(accountCommission(account)),
    otherCharges: amountUnits(accountOtherCharges(account)),
    balance: amountUnits(accountBalance(account))
  };
  const components = ['premium', 'losses', 'commission', 'otherCharges'].map((key) => ({
    key,
    label: LINE_COMPONENT_LABELS[key],
    headerUnits: header[key],
    lineUnits: totals[key],
    differenceUnits: totals[key] - header[key]
  }));
  components.push({
    key: 'balance',
    label: LINE_COMPONENT_LABELS.balance,
    headerUnits: header.balance,
    lineUnits: lineBalance,
    differenceUnits: lineBalance - header.balance
  });
  const rendered = components.map((row) => ({
    key: row.key,
    label: row.label,
    header: unitsToAmount(row.headerUnits),
    lines: unitsToAmount(row.lineUnits),
    difference: unitsToAmount(row.differenceUnits),
    withinTolerance: Math.abs(row.differenceUnits) <= LINE_TOLERANCE_UNITS
  }));
  const hasLines = list.length > 0;
  const reconciled = hasLines && rendered.every((row) => row.withinTolerance);
  return {
    status: !hasLines ? 'empty' : (reconciled ? 'reconciled' : 'unreconciled'),
    hasLines,
    reconciled,
    tolerance: LINE_RECONCILIATION_TOLERANCE,
    header: {
      premium: unitsToAmount(header.premium),
      losses: unitsToAmount(header.losses),
      commission: unitsToAmount(header.commission),
      otherCharges: unitsToAmount(header.otherCharges),
      balance: unitsToAmount(header.balance)
    },
    lines: {
      premium: unitsToAmount(totals.premium),
      losses: unitsToAmount(totals.losses),
      commission: unitsToAmount(totals.commission),
      otherCharges: unitsToAmount(totals.otherCharges),
      balance: unitsToAmount(lineBalance)
    },
    components: rendered,
    byType: summarizeLineTypes(list)
  };
}

export function initialLineForm() {
  return { lineType: 'PREMIUM', reference: '', description: '', amount: '' };
}

export function validateLineForm(form) {
  const issues = [];
  const type = String(form.lineType || '').trim().toUpperCase();
  if (!TECHNICAL_ACCOUNT_LINE_TYPES.includes(type)) {
    issues.push('Line type is required.');
  }
  const rawAmount = form.amount;
  if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') {
    issues.push('Amount is required.');
  } else {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push('Amount must be greater than zero.');
    } else if (amountUnits(rawAmount) <= 0) {
      issues.push('Amount must be at least 0.0001.');
    }
  }
  if (String(form.reference || '').trim().length > 64) {
    issues.push('Reference must be 64 characters or fewer.');
  }
  if (String(form.description || '').trim().length > 255) {
    issues.push('Description must be 255 characters or fewer.');
  }
  return issues;
}

/**
 * Create payload for POST .../lines. The service assigns identity, sequence,
 * and currency from the account; optional text is omitted when blank and the
 * amount is a 4-dp decimal string.
 */
export function buildLinePayload(form) {
  const payload = {
    lineType: String(form.lineType || '').trim().toUpperCase(),
    amount: unitsToAmount(amountUnits(form.amount))
  };
  const reference = String(form.reference || '').trim();
  if (reference) {
    payload.reference = reference;
  }
  const description = String(form.description || '').trim();
  if (description) {
    payload.description = description;
  }
  return payload;
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * Flattens a conflict body into label/detail rows. Structured field violations
 * are the primary form; the service may also report expected and actual totals
 * as top-level values.
 */
export function reconcileErrorRows(error) {
  const rows = [];
  if (error && Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (!detail || (!detail.field && !detail.message)) continue;
      rows.push({
        label: humanizeKey(detail.field || 'detail'),
        value: String(detail.message || detail.detail || '')
      });
    }
  }
  if (rows.length === 0 && error && error.payload) {
    const keys = [
      'expected', 'actual', 'expectedBalance', 'actualBalance', 'lineTotal',
      'headerBalance', 'difference', 'differenceAmount'
    ];
    for (const key of keys) {
      const value = error.payload[key];
      if (value !== undefined && value !== null && value !== '') {
        const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
        rows.push({ label: humanizeKey(key), value: rendered });
      }
    }
  }
  return rows;
}

export function validateCreateForm(form) {
  const issues = [];
  if (!form.periodFrom) {
    issues.push('Period start is required.');
  }
  if (!form.periodTo) {
    issues.push('Period end is required.');
  } else if (form.periodFrom && form.periodTo <= form.periodFrom) {
    issues.push('Period end must be after period start.');
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) {
    issues.push('Currency must be a three-letter ISO code.');
  }
  const amounts = [
    ['cededPremiumAmount', 'Ceded premium'],
    ['cededLossAmount', 'Ceded losses'],
    ['commissionAmount', 'Commission'],
    ['otherChargesAmount', 'Other charges']
  ];
  for (const [key, label] of amounts) {
    const raw = form[key];
    if (raw === undefined || raw === null || raw === '') {
      continue;
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      issues.push(`${label} must be a non-negative number.`);
    }
  }
  return issues;
}

/**
 * Create payload for POST .../technical-accounts. Money is sent as 4-dp decimal
 * strings, matching the domain's numeric scale and the rest of this remote's
 * money handling.
 */
export function buildCreatePayload(form) {
  return {
    periodStart: form.periodFrom,
    periodEnd: form.periodTo,
    currency: String(form.currency || '').trim().toUpperCase(),
    cededPremium: unitsToAmount(amountUnits(form.cededPremiumAmount)),
    cededLosses: unitsToAmount(amountUnits(form.cededLossAmount)),
    commission: unitsToAmount(amountUnits(form.commissionAmount)),
    otherCharges: unitsToAmount(amountUnits(form.otherChargesAmount))
  };
}

export function summarizeTechnicalAccounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let premium = 0;
  let losses = 0;
  let commission = 0;
  let outstanding = 0;
  for (const row of list) {
    premium += amountUnits(accountCededPremium(row));
    losses += amountUnits(accountCededLosses(row));
    commission += amountUnits(accountCommission(row));
    if (accountStatus(row) === TECHNICAL_ACCOUNT_STATUS.ISSUED) {
      outstanding += amountUnits(accountBalance(row));
    }
  }
  return {
    count: list.length,
    cededPremium: unitsToAmount(premium),
    cededLosses: unitsToAmount(losses),
    commission: unitsToAmount(commission),
    outstandingBalance: unitsToAmount(outstanding)
  };
}
