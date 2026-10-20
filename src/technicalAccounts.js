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
