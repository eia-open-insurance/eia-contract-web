/**
 * Cash calls are interim requests for funding on a contract period. The contract
 * holds the terms; a cash call asks the cedent or reinsurer to fund the period
 * ahead of the final settlement. It is not a Payment: Payment and FS-RI own
 * execution, so this module only reads and writes the cash-call request.
 *
 * The lifecycle is REQUESTED -> ISSUED -> SETTLED, or REQUESTED -> CANCELLED.
 * The expert owns call-number generation, the lifecycle invariants, and the
 * stored amount, so this module just owns the wire shape the workbench sends and
 * the small amount of arithmetic the summary cards need.
 *
 * Settlement is a bookkeeping act, not a payment execution. Settling an ISSUED
 * call records the payment/settlement reference that ties the call to the
 * treasury Payment; creating a Payment never settles the call on its own.
 */

/** Four decimal places, matching the domain's numeric(19,4) money columns. */
const SCALE = 10000;

const CASH_CALL_ID_KEYS = ['cashCallId', 'id'];
const CALL_NUMBER_KEYS = ['callNumber', 'cashCallNumber', 'number'];
const PERIOD_FROM_KEYS = ['periodStart', 'periodFrom'];
const PERIOD_TO_KEYS = ['periodEnd', 'periodTo'];
const AMOUNT_KEYS = ['amount', 'callAmount'];
const DUE_DATE_KEYS = ['dueDate', 'due'];
const NOTES_KEYS = ['notes', 'note'];
const SETTLEMENT_REFERENCE_KEYS = [
  'reference',
  'settlementReference',
  'settlementRef',
  'paymentReference'
];

/** The settlement reference is bounded so a pasted line cannot become a payload. */
export const SETTLEMENT_REFERENCE_MAX_LENGTH = 128;

export const CASH_CALL_STATUS = {
  REQUESTED: 'REQUESTED',
  ISSUED: 'ISSUED',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED'
};

const ISSUE = Object.freeze({ status: CASH_CALL_STATUS.ISSUED, label: 'Issue', verb: 'issued' });
const CANCEL = Object.freeze({ status: CASH_CALL_STATUS.CANCELLED, label: 'Cancel', verb: 'cancelled' });
const SETTLE = Object.freeze({ status: CASH_CALL_STATUS.SETTLED, label: 'Settle', verb: 'settled' });

export function cashCallsEndpoint(contractId) {
  return `/api/v1/contracts/${contractId}/cash-calls`;
}

export function cashCallStatusEndpoint(contractId, cashCallId) {
  return `${cashCallsEndpoint(contractId)}/${cashCallId}/status`;
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

export function cashCallRowId(row) {
  const value = pick(row, CASH_CALL_ID_KEYS);
  return value === undefined ? '' : String(value);
}

export function cashCallNumber(row) {
  const value = pick(row, CALL_NUMBER_KEYS);
  return value === undefined ? '' : String(value);
}

export function cashCallPeriodFrom(row) {
  const value = pick(row, PERIOD_FROM_KEYS);
  return value === undefined ? '' : String(value);
}

export function cashCallPeriodTo(row) {
  const value = pick(row, PERIOD_TO_KEYS);
  return value === undefined ? '' : String(value);
}

export function cashCallAmount(row) {
  return pick(row, AMOUNT_KEYS);
}

export function cashCallCurrency(row) {
  const value = pick(row, ['currency']);
  return value === undefined ? '' : String(value).toUpperCase();
}

export function cashCallDueDate(row) {
  const value = pick(row, DUE_DATE_KEYS);
  return value === undefined ? '' : String(value);
}

export function cashCallStatus(row) {
  const value = pick(row, ['status']);
  return value === undefined ? '' : String(value).toUpperCase();
}

export function cashCallNotes(row) {
  const value = pick(row, NOTES_KEYS);
  return value === undefined ? '' : String(value);
}

/**
 * The treasury/payment reference recorded when the call is settled. The expert
 * returns it as `reference`; the aliases keep the panel tolerant of the older
 * settlement vocabulary without inventing a second field on the wire.
 */
export function cashCallSettlementReference(row) {
  const value = pick(row, SETTLEMENT_REFERENCE_KEYS);
  return value === undefined ? '' : String(value);
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
  const from = cashCallPeriodFrom(row) || '—';
  const to = cashCallPeriodTo(row) || '—';
  return `${from} → ${to}`;
}

/** Calendar dates are shown as the service returns them; a timestamp is reduced to its date. */
export function formatDate(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : String(value);
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
 * Newest period first. The period end is the funding period's close, so it leads;
 * the period start and then the call number break ties deterministically even if
 * the service returns the rows in insertion order.
 */
export function sortCashCalls(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byEnd = newestKeyFirst(dateKey(cashCallPeriodTo(left)), dateKey(cashCallPeriodTo(right)));
    if (byEnd !== 0) return byEnd;
    const byStart = newestKeyFirst(
      dateKey(cashCallPeriodFrom(left)),
      dateKey(cashCallPeriodFrom(right))
    );
    if (byStart !== 0) return byStart;
    return newestKeyFirst(cashCallNumber(left), cashCallNumber(right));
  });
}

export function statusTone(status) {
  switch (status) {
    case CASH_CALL_STATUS.SETTLED:
      return 'green';
    case CASH_CALL_STATUS.ISSUED:
      return 'blue';
    case CASH_CALL_STATUS.REQUESTED:
      return 'amber';
    case CASH_CALL_STATUS.CANCELLED:
      return 'red';
    default:
      return 'blue';
  }
}

/**
 * The lifecycle actions a call exposes: a request can be issued or cancelled, and
 * an issued call can be settled. Settled and cancelled calls are terminal.
 */
export function cashCallActions(row) {
  const status = cashCallStatus(row);
  if (status === CASH_CALL_STATUS.REQUESTED) {
    return [ISSUE, CANCEL];
  }
  if (status === CASH_CALL_STATUS.ISSUED) {
    return [SETTLE];
  }
  return [];
}

/**
 * Status payload for PATCH .../status. Issue and cancel send only the target
 * status; settle also carries the required payment/settlement reference that
 * ties the call to the treasury Payment.
 */
export function statusPayload(status, reference) {
  const payload = { status };
  if (status === CASH_CALL_STATUS.SETTLED) {
    payload.reference = String(reference || '').trim();
  }
  return payload;
}

/**
 * Cross-remote hand-off into the Payment workbench. Contract never creates the
 * Payment: the URL carries the source cash call, amount, currency, and payee so
 * Payment can confirm them and save its own record.
 *
 * The link is only meaningful for an ISSUED call: a REQUESTED call has not been
 * approved for funding, and a SETTLED call already has its treasury reference.
 */
export function cashCallPaymentHref(row, payeeName, fallbackCurrency) {
  const sourceId = cashCallRowId(row);
  if (!sourceId) {
    return '';
  }
  const params = new URLSearchParams();
  params.set('new', '1');
  params.set('sourceType', 'CONTRACT_CASH_CALL');
  params.set('sourceId', sourceId);
  params.set('sourceReference', cashCallNumber(row));
  const amount = cashCallAmount(row);
  params.set('amount', amount === undefined || amount === null ? '' : String(amount));
  params.set('currency', cashCallCurrency(row) || fallbackCurrency || 'USD');
  const payee = String(payeeName || '').trim();
  if (payee) {
    params.set('payeeName', payee);
  }
  return `/payment?${params.toString()}`;
}

/** Settle form validation: the reference is required and bounded. */
export function validateSettleForm(form) {
  const reference = String(form?.reference || '').trim();
  if (!reference) {
    return ['Settlement reference is required.'];
  }
  if (reference.length > SETTLEMENT_REFERENCE_MAX_LENGTH) {
    return [
      `Settlement reference must be ${SETTLEMENT_REFERENCE_MAX_LENGTH} characters or fewer.`
    ];
  }
  return [];
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function validateCreateForm(form) {
  const issues = [];
  if (!isValidDate(form.periodStart)) {
    issues.push('Period start is required.');
  }
  if (!isValidDate(form.periodEnd)) {
    issues.push('Period end is required.');
  } else if (form.periodStart && form.periodEnd <= form.periodStart) {
    issues.push('Period end must be after period start.');
  }
  const rawAmount = form.amount;
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    issues.push('Amount is required.');
  } else {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push('Amount must be greater than zero.');
    }
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) {
    issues.push('Currency must be a three-letter ISO code.');
  }
  if (!isValidDate(form.dueDate)) {
    issues.push('Due date is required.');
  }
  if (String(form.notes || '').length > 4000) {
    issues.push('Notes must be 4000 characters or fewer.');
  }
  return issues;
}

/** Converts a decimal amount to integer ten-thousandths so summaries add exactly. */
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
 * Create payload for POST .../cash-calls. The expert assigns the call number and
 * starts the status at REQUESTED, so neither is sent. A blank note is omitted
 * rather than sent empty; the amount is a 4-dp decimal string.
 */
export function buildCreatePayload(form) {
  const payload = {
    periodStart: form.periodStart,
    periodEnd: form.periodEnd,
    amount: unitsToAmount(amountUnits(form.amount)),
    currency: String(form.currency || '').trim().toUpperCase(),
    dueDate: form.dueDate
  };
  const notes = String(form.notes || '').trim();
  if (notes) {
    payload.notes = notes;
  }
  return payload;
}

/** Local calendar date key, so "overdue" follows the browser's day boundary. */
export function todayKey(today = new Date()) {
  const date = today instanceof Date ? today : new Date(today);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * An open call (still requested or issued) whose due date has already passed is
 * overdue. Settled and cancelled calls are terminal, so they are never overdue.
 */
export function isOverdue(row, today = new Date()) {
  const status = cashCallStatus(row);
  if (status !== CASH_CALL_STATUS.REQUESTED && status !== CASH_CALL_STATUS.ISSUED) {
    return false;
  }
  const due = dateKey(cashCallDueDate(row));
  if (!due) return false;
  const key = todayKey(today);
  return Boolean(key) && due < key;
}

/**
 * Summary cards: counts of requested and issued calls, the outstanding issued
 * amount, the settled amount, and the number of open calls whose due date has
 * passed. "Issued amount" is the funding still outstanding (ISSUED only);
 * settled calls are reported in their own amount.
 */
export function summarizeCashCalls(rows, today = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  let requestedCount = 0;
  let issuedCount = 0;
  let issuedAmount = 0;
  let settledCount = 0;
  let settledAmount = 0;
  let overdueCount = 0;
  for (const row of list) {
    const status = cashCallStatus(row);
    if (status === CASH_CALL_STATUS.REQUESTED) {
      requestedCount += 1;
    }
    if (status === CASH_CALL_STATUS.ISSUED) {
      issuedCount += 1;
      issuedAmount += amountUnits(cashCallAmount(row));
    }
    if (status === CASH_CALL_STATUS.SETTLED) {
      settledCount += 1;
      settledAmount += amountUnits(cashCallAmount(row));
    }
    if (isOverdue(row, today)) {
      overdueCount += 1;
    }
  }
  return {
    count: list.length,
    requestedCount,
    issuedCount,
    issuedAmount: unitsToAmount(issuedAmount),
    settledCount,
    settledAmount: unitsToAmount(settledAmount),
    overdueCount
  };
}
