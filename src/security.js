/**
 * Security is the collateral a reinsurer (or its provider) posts against the
 * obligations of a contract: a letter of credit, trust fund, funds withheld,
 * guarantee, or similar instrument. It is collateral, not cash, and it is not a
 * Payment. Releasing or expiring a record returns or lapses collateral; Payment
 * and FS-RI own execution, so this module only reads and writes the collateral
 * row itself.
 *
 * The public API derives the initial status (ACTIVE, or EXPIRED when the expiry
 * date is already past) and exposes two terminal commands, RELEASED and EXPIRED.
 * Records in any non-terminal status still show both actions.
 */

/** Four decimal places, matching the domain's numeric(19,4) money columns. */
const SCALE = 10000;

const SECURITY_ID_KEYS = ['securityId', 'id'];
const SECURITY_TYPE_KEYS = ['securityType', 'type'];
const REQUIRED_KEYS = ['requiredAmount', 'required'];
const HELD_KEYS = ['heldAmount', 'held'];
const CURRENCY_KEYS = ['currency'];
const PROVIDER_KEYS = ['providerPartyId', 'providerId', 'provider'];
const EXPIRY_KEYS = ['expiryDate', 'expiry'];
const APPROVAL_KEYS = ['approvalRef', 'approvalReference', 'approval'];

export const SECURITY_TYPES = Object.freeze([
  'LETTER_OF_CREDIT',
  'TRUST_FUND',
  'FUNDS_WITHHELD',
  'CASH_ADVANCE',
  'PARENT_GUARANTEE',
  'BANK_GUARANTEE',
  'SECURITIES'
]);

export const SECURITY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED'
});

const TERMINAL_STATUSES = new Set([
  SECURITY_STATUS.RELEASED,
  SECURITY_STATUS.EXPIRED
]);

const RELEASE = Object.freeze({
  status: SECURITY_STATUS.RELEASED,
  label: 'Release',
  verb: 'released'
});
const EXPIRE = Object.freeze({
  status: SECURITY_STATUS.EXPIRED,
  label: 'Expire',
  verb: 'expired'
});

export function securityEndpoint(contractId) {
  return `/api/v1/contracts/${contractId}/security`;
}

export function securityStatusEndpoint(contractId, securityId) {
  return `${securityEndpoint(contractId)}/${securityId}/status`;
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

export function securityRowId(row) {
  const value = pick(row, SECURITY_ID_KEYS);
  return value === undefined ? '' : String(value);
}

export function securityType(row) {
  const value = pick(row, SECURITY_TYPE_KEYS);
  return value === undefined ? '' : String(value).trim().toUpperCase();
}

export function securityRequiredAmount(row) {
  return pick(row, REQUIRED_KEYS);
}

export function securityHeldAmount(row) {
  return pick(row, HELD_KEYS);
}

export function securityCurrency(row) {
  const value = pick(row, CURRENCY_KEYS);
  return value === undefined ? '' : String(value).trim().toUpperCase();
}

export function securityProviderPartyId(row) {
  const value = pick(row, PROVIDER_KEYS);
  return value === undefined ? '' : String(value).trim();
}

export function securityExpiryDate(row) {
  const value = pick(row, EXPIRY_KEYS);
  return value === undefined ? '' : String(value).trim();
}

export function securityApprovalRef(row) {
  const value = pick(row, APPROVAL_KEYS);
  return value === undefined ? '' : String(value).trim();
}

export function securityStatus(row) {
  const value = pick(row, ['status']);
  return value === undefined ? '' : String(value).trim().toUpperCase();
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || '').trim().toUpperCase());
}

export function securityIsTerminal(row) {
  return isTerminalStatus(securityStatus(row));
}

/**
 * The lifecycle actions a record exposes. RELEASED and EXPIRED are terminal;
 * every other status can still be released or expired.
 */
export function securityActions(row) {
  return securityIsTerminal(row) ? [] : [RELEASE, EXPIRE];
}

export function statusPayload(status) {
  return { status };
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

/** Calendar dates are shown as the service returns them; a timestamp is reduced to its date. */
export function formatDate(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : String(value);
}

export function statusTone(status) {
  switch (String(status || '').trim().toUpperCase()) {
    case SECURITY_STATUS.ACTIVE:
      return 'green';
    case SECURITY_STATUS.RELEASED:
      return 'blue';
    case SECURITY_STATUS.EXPIRED:
      return 'amber';
    case 'BREACH':
      return 'red';
    default:
      return 'amber';
  }
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

function isCalendarDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/**
 * Local validation for the create form. The required obligation must be
 * strictly positive, held collateral may be zero but never negative, the
 * currency is an ISO code, and an optional expiry/approval reference must be
 * well formed. The service remains authoritative.
 */
export function validateCreateForm(form) {
  const issues = [];
  if (!SECURITY_TYPES.includes(String(form.securityType || '').toUpperCase())) {
    issues.push('Security type is required.');
  }
  const rawRequired = form.requiredAmount;
  if (rawRequired === undefined || rawRequired === null || String(rawRequired).trim() === '') {
    issues.push('Required amount is required.');
  } else {
    const required = Number(rawRequired);
    if (!Number.isFinite(required) || required <= 0) {
      issues.push('Required amount must be greater than zero.');
    }
  }
  const rawHeld = form.heldAmount;
  if (rawHeld !== undefined && rawHeld !== null && String(rawHeld).trim() !== '') {
    const held = Number(rawHeld);
    if (!Number.isFinite(held) || held < 0) {
      issues.push('Held amount must be zero or greater.');
    }
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || '').trim())) {
    issues.push('Currency must be a three-letter ISO code.');
  }
  const expiry = String(form.expiryDate || '').trim();
  if (expiry && !isCalendarDate(expiry)) {
    issues.push('Expiry date must be a valid date.');
  }
  if (String(form.approvalRef || '').trim().length > 64) {
    issues.push('Approval reference must be 64 characters or fewer.');
  }
  return issues;
}

/**
 * Create payload for POST .../security. Identity and status are assigned by the
 * service, so neither is sent. Amounts are 4-dp decimal strings; optional
 * fields are omitted rather than sent blank.
 */
export function buildCreatePayload(form) {
  const payload = {
    securityType: String(form.securityType || '').trim().toUpperCase(),
    requiredAmount: unitsToAmount(amountUnits(form.requiredAmount)),
    currency: String(form.currency || '').trim().toUpperCase()
  };
  const held = String(form.heldAmount ?? '').trim();
  if (held) {
    payload.heldAmount = unitsToAmount(amountUnits(held));
  }
  const providerPartyId = String(form.providerPartyId || '').trim();
  if (providerPartyId) {
    payload.providerPartyId = providerPartyId;
  }
  const expiryDate = String(form.expiryDate || '').trim();
  if (expiryDate) {
    payload.expiryDate = expiryDate;
  }
  const approvalRef = String(form.approvalRef || '').trim();
  if (approvalRef) {
    payload.approvalRef = approvalRef;
  }
  return payload;
}

/**
 * Summary cards: the total secured obligation, the collateral actually held,
 * the outstanding gap (required minus held, which can be negative when the
 * book is over-collateralised), the count of records still in force
 * (everything not RELEASED or EXPIRED), and the count of RELEASED records.
 * Totals cover every record the service returns, including terminal ones.
 */
export function summarizeSecurity(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let requiredUnits = 0;
  let heldUnits = 0;
  let activeCount = 0;
  let releasedCount = 0;
  for (const row of list) {
    requiredUnits += amountUnits(securityRequiredAmount(row));
    heldUnits += amountUnits(securityHeldAmount(row));
    const status = securityStatus(row);
    if (!isTerminalStatus(status)) {
      activeCount += 1;
    }
    if (status === SECURITY_STATUS.RELEASED) {
      releasedCount += 1;
    }
  }
  return {
    count: list.length,
    requiredTotal: unitsToAmount(requiredUnits),
    heldTotal: unitsToAmount(heldUnits),
    outstanding: unitsToAmount(requiredUnits - heldUnits),
    activeCount,
    releasedCount
  };
}
