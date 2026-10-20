/**
 * Contract activity helpers.
 *
 * The platform event-ingest service exposes the append-only event stream for one
 * aggregate: `GET /api/v1/events/aggregate/{contractId}?limit=50` with the tenant
 * in `X-EIA-Tenant`. An event is a fact that already happened; the contract
 * record remains the source of truth for the current status, terms, cessions,
 * and commutation, and nothing in this timeline can change them.
 */

export const ACTIVITY_LIMIT = 50;

/** Builds GET /api/v1/events/aggregate/{contractId}?limit=… for one contract. */
export function activityEndpoint(contractId, limit = ACTIVITY_LIMIT) {
  const id = String(contractId || '').trim();
  if (!id) return '';
  return `/api/v1/events/aggregate/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}`;
}

const WORD_SEPARATOR = /[._\-\s]+/;

/**
 * Turns `contract.contract.bound` into “Contract bound”. Adjacent repeated
 * tokens are collapsed so the vertical prefix does not stutter, and every
 * separator style used by event names becomes a word break.
 */
export function readableEventType(eventType) {
  const words = String(eventType || '')
    .split(WORD_SEPARATOR)
    .map((word) => word.trim())
    .filter(Boolean);

  const deduped = [];
  for (const word of words) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.toLowerCase() === word.toLowerCase()) continue;
    deduped.push(word);
  }

  if (deduped.length === 0) return 'Contract event';
  return deduped
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(' ');
}

/** Event delivery/processing status tone, distinct from the contract status. */
export function eventStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (['PROCESSED', 'APPLIED', 'ACCEPTED', 'COMPLETE', 'COMPLETED', 'SUCCEEDED'].includes(value)) {
    return 'green';
  }
  if (['FAILED', 'REJECTED', 'ERROR', 'DEAD_LETTERED', 'DEAD_LETTER'].includes(value)) {
    return 'red';
  }
  if (['RECEIVED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'HELD', 'QUARANTINED'].includes(value)) {
    return 'amber';
  }
  return 'blue';
}

export function formatEventTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const stamp = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(date);
  return `${stamp} UTC`;
}

export function formatEventMoney(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return currency ? `${amount} ${currency}` : String(amount);
  }
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readPath(source, path) {
  let current = source;
  for (const segment of path.split('.')) {
    const object = asObject(current);
    if (!object || !Object.prototype.hasOwnProperty.call(object, segment)) return undefined;
    current = object[segment];
  }
  return current;
}

function textValue(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * The event service embeds the canonical envelope in `payload` and the contract
 * facts live in its `data` object. Tests and future projections may also send
 * the data object directly, so both shapes are accepted.
 */
export function eventData(event) {
  const payload = asObject(event?.payload);
  if (!payload) return {};
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function occurredAtMillis(event) {
  const occurred = Date.parse(event?.occurredAt);
  if (Number.isFinite(occurred)) return occurred;
  const received = Date.parse(event?.receivedAt);
  return Number.isFinite(received) ? received : 0;
}

function aggregateVersion(event) {
  const version = Number(event?.aggregateVersion);
  return Number.isFinite(version) ? version : -1;
}

/**
 * Accepts the `{ items }` page (or a bare array) and returns newest-first,
 * non-null events. Ties fall back to aggregate version and event id so the
 * rendering order is deterministic even when two events share a timestamp.
 */
export function activityItems(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort((left, right) => {
      const byTime = occurredAtMillis(right) - occurredAtMillis(left);
      if (byTime !== 0) return byTime;
      const byVersion = aggregateVersion(right) - aggregateVersion(left);
      if (byVersion !== 0) return byVersion;
      return String(left?.eventId || '').localeCompare(String(right?.eventId || ''));
    });
}

function isTrue(value) {
  return ['true', 'yes', 'y', '1'].includes(String(value || '').trim().toLowerCase());
}

function approvalLabel(eventType) {
  const value = String(eventType || '').toLowerCase();
  if (value.includes('commut')) return 'Commutation approval';
  if (value.includes('bind') || value.includes('bound') || value.includes('place')) {
    return 'Bind approval';
  }
  return 'Approval';
}

/**
 * The business facts a contract event carries: the status transition, the
 * version it produced, the bind approval, and the cession or commutation detail
 * that moved the contract. Absent facts are omitted rather than rendered blank,
 * because not every event type carries every fact.
 */
export function payloadFacts(event) {
  const data = eventData(event);
  const facts = [];

  const from = textValue(data, ['from', 'fromStatus', 'previousStatus', 'oldStatus', 'status.from']);
  const to = textValue(data, ['to', 'toStatus', 'newStatus', 'status.to']);
  const currentStatus = textValue(data, ['status', 'contractStatus']);
  if (from && to) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (from) {
    facts.push({ key: 'status', label: 'Status', value: `${from} →` });
  } else if (to || currentStatus) {
    facts.push({ key: 'status', label: 'Status', value: to || currentStatus });
  }

  const version = textValue(data, ['contractVersion', 'versionNumber', 'version'])
    || (event?.aggregateVersion !== null && event?.aggregateVersion !== undefined
      ? String(event.aggregateVersion)
      : '');
  if (version) {
    facts.push({ key: 'version', label: 'Version', value: version });
  }

  const approval = textValue(data, [
    'approvedBy',
    'bindApprovedBy',
    'commutationApprovedBy',
    'approvedByPartyId',
    'bind.approvedBy'
  ]);
  if (approval) {
    facts.push({ key: 'approval', label: approvalLabel(event?.eventType), value: approval });
  }

  const boundAt = textValue(data, ['boundAt', 'bindApprovedAt', 'bound.approvedAt']);
  if (boundAt) {
    facts.push({ key: 'bound-at', label: 'Bound at', value: formatEventTimestamp(boundAt) });
  } else if (isTrue(textValue(data, ['bound', 'boundFlag']))) {
    facts.push({ key: 'bound-at', label: 'Bound', value: 'Yes' });
  }

  const currency = textValue(data, ['currency', 'cessionCurrency', 'commutation.currency']);

  const cessionNumber = textValue(data, ['cessionNumber', 'cession.number']);
  if (cessionNumber) {
    facts.push({ key: 'cession', label: 'Cession', value: cessionNumber });
  }
  const cededPremium = textValue(data, [
    'cededPremiumAmount',
    'cededPremium',
    'cession.cededPremiumAmount'
  ]);
  if (cededPremium) {
    facts.push({
      key: 'ceded-premium',
      label: 'Ceded premium',
      value: formatEventMoney(cededPremium, currency)
    });
  }
  const cededLoss = textValue(data, ['cededLossAmount', 'cededLoss', 'cession.cededLossAmount']);
  if (cededLoss) {
    facts.push({
      key: 'ceded-loss',
      label: 'Ceded loss',
      value: formatEventMoney(cededLoss, currency)
    });
  }
  const cessionPct = textValue(data, ['cessionPct', 'cessionPercentage', 'sharePct']);
  if (cessionPct) {
    facts.push({ key: 'cession-share', label: 'Cession share', value: `${cessionPct}%` });
  }

  const commutationNumber = textValue(data, ['commutationNumber', 'commutation.number']);
  if (commutationNumber) {
    facts.push({ key: 'commutation', label: 'Commutation', value: commutationNumber });
  }
  const commutationType = textValue(data, ['commutationType', 'commutation.type']);
  if (commutationType) {
    facts.push({ key: 'commutation-type', label: 'Commutation type', value: commutationType });
  }
  const commutationBasis = textValue(data, ['commutationBasis', 'commutation.basis', 'basis']);
  if (commutationBasis) {
    facts.push({ key: 'commutation-basis', label: 'Commutation basis', value: commutationBasis });
  }
  const agreedAmount = textValue(data, [
    'agreedAmount',
    'settlementAmount',
    'commutationAmount',
    'commutation.agreedAmount'
  ]);
  if (agreedAmount) {
    facts.push({
      key: 'agreed-amount',
      label: 'Agreed amount',
      value: formatEventMoney(agreedAmount, currency)
    });
  }
  const commutationEffective = textValue(data, [
    'commutationEffectiveDate',
    'commutation.effectiveDate'
  ]);
  if (commutationEffective) {
    facts.push({ key: 'commutation-effective', label: 'Commutation effective', value: commutationEffective });
  }

  const reason = textValue(data, ['reason', 'cancellationReason', 'commutationReason']);
  if (reason) {
    facts.push({ key: 'reason', label: 'Reason', value: reason });
  }

  return facts;
}
