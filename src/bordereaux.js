/**
 * Bordereaux are the cedent's periodic submissions: premium, loss, commission,
 * and charges for one period, delivered as a file or a manual statement. The
 * contract holds the terms; processing a bordereau produces the period's
 * technical account.
 *
 * This module owns the wire shape the workbench sends, the tolerant reading of
 * the row shape the service returns, and the small amount of arithmetic the
 * browser needs for the period totals. The domain service remains authoritative
 * for the stored amounts and for the technical account a processed bordereau
 * creates.
 */

/** Four decimal places, matching the domain's numeric(19,4) money columns. */
const SCALE = 10000;

const PERIOD_FROM_KEYS = ['periodStart', 'periodFrom'];
const PERIOD_TO_KEYS = ['periodEnd', 'periodTo'];
const RECEIVED_KEYS = ['receivedDate', 'receivedAt'];
const PREMIUM_KEYS = ['premiumAmount', 'premium', 'totalPremium', 'cededPremium'];
const LOSS_KEYS = ['lossAmount', 'loss', 'losses', 'cededLosses'];
const COMMISSION_KEYS = ['commissionAmount', 'commission'];
const OTHER_CHARGE_KEYS = ['otherChargesAmount', 'otherCharges'];
const LINE_COUNT_KEYS = ['lineCount', 'lines'];
const BORDEREAU_ID_KEYS = ['bordereauId', 'id'];
const BORDEREAU_NUMBER_KEYS = ['bordereauNumber', 'number'];
const ACCOUNT_ID_KEYS = ['technicalAccountId', 'accountId'];
const ACCOUNT_NUMBER_KEYS = ['technicalAccountNumber', 'accountNumber'];

export const BORDEREAU_STATUS = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED'
};

export function bordereauxEndpoint(contractId) {
  return `/api/v1/contracts/${contractId}/bordereaux`;
}

export function bordereauStatusEndpoint(contractId, bordereauId) {
  return `${bordereauxEndpoint(contractId)}/${bordereauId}/status`;
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

export function bordereauRowId(row) {
  const value = pick(row, BORDEREAU_ID_KEYS);
  return value === undefined ? '' : String(value);
}

export function bordereauNumber(row) {
  const value = pick(row, BORDEREAU_NUMBER_KEYS);
  return value === undefined ? '' : String(value);
}

export function bordereauPeriodFrom(row) {
  const value = pick(row, PERIOD_FROM_KEYS);
  return value === undefined ? '' : String(value);
}

export function bordereauPeriodTo(row) {
  const value = pick(row, PERIOD_TO_KEYS);
  return value === undefined ? '' : String(value);
}

/**
 * The received value is a timestamp on the wire; the workbench shows the date
 * the cedent's submission landed, not the time of day.
 */
export function bordereauReceivedDate(row) {
  const value = pick(row, RECEIVED_KEYS);
  if (value === undefined) return '';
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

export function bordereauCurrency(row) {
  const value = pick(row, ['currency']);
  return value === undefined ? '' : String(value).toUpperCase();
}

export function bordereauPremium(row) {
  return pick(row, PREMIUM_KEYS);
}

export function bordereauLoss(row) {
  return pick(row, LOSS_KEYS);
}

export function bordereauCommission(row) {
  return pick(row, COMMISSION_KEYS);
}

export function bordereauOtherCharges(row) {
  return pick(row, OTHER_CHARGE_KEYS);
}

export function bordereauLineCount(row) {
  const value = pick(row, LINE_COUNT_KEYS);
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

export function bordereauStatus(row) {
  const value = pick(row, ['status']);
  return value === undefined ? '' : String(value).toUpperCase();
}

/**
 * A processed bordereau names the technical account it created. The service may
 * return the account as flat fields or as a nested object, so accept both.
 */
export function linkedTechnicalAccount(row) {
  const nested = row && row.technicalAccount && typeof row.technicalAccount === 'object'
    ? row.technicalAccount
    : null;
  const idValue = pick(nested, ACCOUNT_ID_KEYS) ?? pick(row, ACCOUNT_ID_KEYS);
  const numberValue = pick(nested, ACCOUNT_NUMBER_KEYS) ?? pick(row, ACCOUNT_NUMBER_KEYS);
  const id = idValue === undefined ? '' : String(idValue);
  const number = numberValue === undefined ? '' : String(numberValue);
  if (!id && !number) {
    return null;
  }
  return { id, number };
}

export function formatPeriod(row) {
  const from = bordereauPeriodFrom(row) || '—';
  const to = bordereauPeriodTo(row) || '—';
  return `${from} → ${to}`;
}

/**
 * Converts a decimal amount to integer ten-thousandths so period totals add
 * exactly. Returns 0 for blank or non-numeric input; callers validate before
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
 * Newest period first. The period end is the submission date, so it leads; the
 * period start and then the bordereau number break ties deterministically even
 * if the service returns the rows in insertion order.
 */
export function sortBordereaux(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byEnd = newestKeyFirst(dateKey(bordereauPeriodTo(left)), dateKey(bordereauPeriodTo(right)));
    if (byEnd !== 0) return byEnd;
    const byStart = newestKeyFirst(
      dateKey(bordereauPeriodFrom(left)),
      dateKey(bordereauPeriodFrom(right))
    );
    if (byStart !== 0) return byStart;
    return newestKeyFirst(bordereauNumber(left), bordereauNumber(right));
  });
}

export function statusTone(status) {
  switch (status) {
    case BORDEREAU_STATUS.PROCESSED:
      return 'green';
    case BORDEREAU_STATUS.RECEIVED:
      return 'amber';
    case BORDEREAU_STATUS.FAILED:
      return 'red';
    default:
      return 'blue';
  }
}

/** Only a received submission can be processed or failed; the rest are terminal. */
export function isActionable(row) {
  return bordereauStatus(row) === BORDEREAU_STATUS.RECEIVED && Boolean(bordereauRowId(row));
}

export function processPayload() {
  return { status: BORDEREAU_STATUS.PROCESSED };
}

/** Fail accepts an optional note; an empty note is omitted rather than sent blank. */
export function failPayload(note) {
  const payload = { status: BORDEREAU_STATUS.FAILED };
  const trimmed = String(note || '').trim();
  if (trimmed) {
    payload.notes = trimmed;
  }
  return payload;
}

/**
 * The create command takes a calendar date, so keep the value the date input
 * produced. A timestamp is reduced to its date part for tolerance with older
 * callers.
 */
export function receivedDateFromInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
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
  if (!form.receivedDate) {
    issues.push('Received date is required.');
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) {
    issues.push('Currency must be a three-letter ISO code.');
  }
  const amounts = [
    ['premium', 'Premium'],
    ['loss', 'Loss'],
    ['commission', 'Commission'],
    ['otherCharges', 'Other charges']
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
  if (form.lineCount !== undefined && form.lineCount !== null && form.lineCount !== '') {
    const lines = Number(form.lineCount);
    if (!Number.isInteger(lines) || lines < 0) {
      issues.push('Line count must be a non-negative integer.');
    }
  }
  if (String(form.notes || '').length > 400) {
    issues.push('Notes must be 400 characters or fewer.');
  }
  return issues;
}

/**
 * Create payload for POST .../bordereaux. The service generates the bordereau
 * number and starts the status at RECEIVED; the period bounds and received date
 * are calendar dates, and the submission amounts are 4-dp decimal strings,
 * matching the domain's numeric scale.
 */
export function buildCreatePayload(form) {
  const notes = String(form.notes || '').trim();
  const payload = {
    periodStart: form.periodFrom,
    periodEnd: form.periodTo,
    receivedDate: receivedDateFromInput(form.receivedDate),
    currency: String(form.currency || '').trim().toUpperCase(),
    premiumAmount: unitsToAmount(amountUnits(form.premium)),
    lossAmount: unitsToAmount(amountUnits(form.loss)),
    commissionAmount: unitsToAmount(amountUnits(form.commission)),
    otherChargesAmount: unitsToAmount(amountUnits(form.otherCharges)),
    lineCount: Number(form.lineCount || 0)
  };
  if (notes) {
    payload.notes = notes;
  }
  return payload;
}

export function summarizeBordereaux(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let premium = 0;
  let loss = 0;
  let lineCount = 0;
  let receivedCount = 0;
  let processedCount = 0;
  for (const row of list) {
    premium += amountUnits(bordereauPremium(row));
    loss += amountUnits(bordereauLoss(row));
    lineCount += bordereauLineCount(row);
    const status = bordereauStatus(row);
    if (status === BORDEREAU_STATUS.RECEIVED) {
      receivedCount += 1;
    }
    if (status === BORDEREAU_STATUS.PROCESSED) {
      processedCount += 1;
    }
  }
  return {
    count: list.length,
    receivedCount,
    processedCount,
    premium: unitsToAmount(premium),
    loss: unitsToAmount(loss),
    lineCount
  };
}
