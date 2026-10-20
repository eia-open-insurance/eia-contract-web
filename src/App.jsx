import React, { useEffect, useState } from 'react';
import './ui.css';
import './ui-overrides.css';
import { apiFetch, errorMessage, APPROVER, TENANT } from './api';
import ResourceSection from './ResourceSection';
import ParticipantsPanel from './ParticipantsPanel';
import CessionsPanel from './CessionsPanel';

const CONTRACT_TYPES = [
  'QUOTA_SHARE',
  'SURPLUS',
  'FACULTATIVE',
  'FACULTATIVE_OBLIGATORY',
  'EXCESS_OF_LOSS',
  'AGGREGATE_EXCESS_OF_LOSS',
  'STOP_LOSS',
  'CATASTROPHE_EXCESS_OF_LOSS',
  'CLASH',
  'ADVERSE_DEVELOPMENT_COVER',
  'LOSS_PORTFOLIO_TRANSFER',
  'RETROCESSION',
  'FRONTING',
  'FINITE',
  'PROPORTIONAL_TREATY',
  'NON_PROPORTIONAL_TREATY'
];

const LAYER_TYPES = [
  'PROPORTIONAL', 'EXCESS_OF_LOSS', 'AGGREGATE_EXCESS', 'STOP_LOSS',
  'CATASTROPHE', 'CLASH', 'FACULTATIVE', 'TOP_AND_DROP'
];

const LIMIT_BASES = ['PER_OCCURRENCE', 'PER_RISK', 'PER_EVENT', 'ANNUAL_AGGREGATE', 'POLICY_YEAR', 'PER_LOSS'];

const TERM_CODES = [
  'GOVERNING_LAW', 'SETTLEMENT_BASIS', 'CEDING_COMMISSION_PCT', 'BROKERAGE_PCT',
  'REINSTATEMENT_PROVISION', 'ULTIMATE_NET_LOSS', 'DEPOSIT_PREMIUM_AMOUNT',
  'MINIMUM_PREMIUM_AMOUNT', 'FUNDS_WITHHELD_PCT', 'PROFIT_COMMISSION_PCT',
  'PORTFOLIO_SCHEDULE_REF', 'ACTUARIAL_ASSUMPTIONS_REF', 'DEVELOPMENT_PATTERN_REF',
  'INCEPTION_BALANCE_AMOUNT', 'SUNSET_DATE', 'COMMUTATION_WINDOW_MONTHS',
  'PAYMENT_TERMS_DAYS', 'OFFSET_ALLOWED', 'CASH_CALL_ALLOWED', 'AUDIT_RIGHTS'
];

const CLAUSE_CODES = [
  'FOLLOW_THE_FORTUNES', 'FOLLOW_THE_SETTLEMENTS', 'CLAIMS_CONTROL', 'CLAIMS_COOPERATION',
  'CUT_THROUGH', 'OFFSET', 'ULTIMATE_NET_LOSS', 'OCCURRENCE', 'SUNSET', 'COMMUTATION',
  'REINSTATEMENT', 'LOSS_CORRIDOR', 'LOSS_PORTFOLIO_TRANSFER', 'ADVERSE_DEVELOPMENT',
  'GOVERNING_LAW', 'ARBITRATION'
];

const SECURITY_TYPES = [
  'LETTER_OF_CREDIT', 'TRUST_FUND', 'FUNDS_WITHHELD', 'CASH_ADVANCE',
  'PARENT_GUARANTEE', 'BANK_GUARANTEE', 'SECURITIES'
];

const BORDEREAU_TYPES = [
  'PREMIUM', 'CLAIMS', 'CESSION', 'ACCOUNTING', 'LOSS_DEVELOPMENT', 'SECURITY', 'CASH_LOSS'
];

const SOURCE_FORMATS = ['CSV', 'XLSX', 'XML', 'JSON', 'MANUAL'];

const COMMUTATION_TYPES = ['FULL', 'PARTIAL', 'LOSS_PORTFOLIO', 'BUYOUT', 'NOVATION'];

const COMMUTATION_BASES = ['NEGOTIATED', 'CONTRACTUAL', 'INDUCED', 'REGULATORY', 'INSOLVENCY'];

const NEXT_STATUS = {
  DRAFT: ['QUOTED', 'VOID'],
  QUOTED: ['PLACED', 'VOID'],
  PLACED: ['VOID'],
  BOUND: ['SIGNED', 'VOID'],
  SIGNED: ['IN_FORCE', 'VOID'],
  IN_FORCE: ['ENDORSED', 'EXPIRED', 'CANCELLED', 'COMMUTED'],
  ENDORSED: ['IN_FORCE'],
  EXPIRED: ['RUNOFF', 'CLOSED'],
  RUNOFF: ['COMMUTED', 'CLOSED'],
  COMMUTED: ['CLOSED'],
  CANCELLED: ['CLOSED'],
  CLOSED: [],
  VOID: []
};

const BOUND_STATUSES = new Set(['BOUND', 'SIGNED', 'IN_FORCE', 'ENDORSED', 'EXPIRED', 'RUNOFF', 'COMMUTED', 'CLOSED']);

const RISK_BEARING = new Set(['REINSURER', 'LEAD', 'FOLLOW', 'FRONTING', 'RETROCESSIONAIRE']);

const TABS = [
  'Overview',
  'Layers',
  'Participants',
  'Terms',
  'Security',
  'Cessions',
  'Bordereaux',
  'Commutation'
];

const EMPTY_FORM = {
  contractNumber: '',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: '44444444-4444-7444-8444-444444444444',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD'
};

const EMPTY_SUMMARY = { layers: [], participants: [], cessions: [] };

function emptySummary() {
  return { layers: [], participants: [], cessions: [] };
}

function errorMessageFrom(payload, fallback) {
  if (payload && typeof payload.message === 'string') {
    return `${payload.code || 'ERROR'}: ${payload.message}`;
  }
  return fallback;
}

function shortId(value) {
  return value ? String(value).slice(0, 8) : '—';
}

function money(value, currency) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return String(value);
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency || ''}`.trim();
  }
}

function statusTone(status) {
  if (['BOUND', 'SIGNED', 'IN_FORCE', 'ENDORSED', 'CLOSED', 'COMMUTED'].includes(status)) {
    return 'green';
  }
  if (['VOID', 'CANCELLED'].includes(status)) {
    return 'red';
  }
  if (['DRAFT', 'QUOTED', 'PLACED', 'EXPIRED', 'RUNOFF'].includes(status)) {
    return 'amber';
  }
  return 'blue';
}

function sumBy(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) || 0), 0);
}

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Overview');
  const [selectedId, setSelectedId] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [bindMessage, setBindMessage] = useState('');
  const [binding, setBinding] = useState(false);
  const [transitionTo, setTransitionTo] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);

  const selected = contracts.find((contract) => contract.id === selectedId) || null;

  async function load() {
    const response = await fetch('/api/v1/contracts', { headers: { 'X-EIA-Tenant': TENANT } });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    setContracts(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEligibility(null);
      setEligibilityError('');
      return;
    }
    let cancelled = false;
    setEligibility(null);
    setEligibilityError('');
    apiFetch(`/api/v1/contracts/${selectedId}/bind-eligibility`)
      .then((data) => {
        if (!cancelled) {
          setEligibility(data);
          setEligibilityError('');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setEligibility(null);
          setEligibilityError(errorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshToken]);

  useEffect(() => {
    if (!selectedId) {
      setSummary(emptySummary());
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      apiFetch(`/api/v1/contracts/${selectedId}/layers`),
      apiFetch(`/api/v1/contracts/${selectedId}/participants`),
      apiFetch(`/api/v1/contracts/${selectedId}/cessions`)
    ]).then(([layers, participants, cessions]) => {
      if (cancelled) {
        return;
      }
      const rowsOf = (result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
      setSummary({
        layers: rowsOf(layers),
        participants: rowsOf(participants),
        cessions: rowsOf(cessions)
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshToken]);

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  async function reloadWorkspace() {
    setError('');
    try {
      await load();
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessageFrom(payload, `Create failed: ${response.status}`));
        return;
      }
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectContract(contract) {
    setSelectedId(contract.id);
    setTab('Overview');
    setBindMessage('');
    setTransitionTo('');
  }

  async function bind() {
    if (!selected) {
      return;
    }
    setBinding(true);
    setError('');
    setBindMessage('');
    try {
      const result = await apiFetch(`/api/v1/contracts/${selected.id}/bind`, {
        method: 'POST',
        body: JSON.stringify({ approvedBy: APPROVER, expectedVersion: selected.version })
      });
      setBindMessage(`Contract ${result.contract.contractNumber} is ${result.contract.status}.`);
      await load();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBinding(false);
    }
  }

  async function transition() {
    if (!selected || !transitionTo) {
      return;
    }
    setError('');
    try {
      await apiFetch(`/api/v1/contracts/${selected.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: transitionTo, expectedVersion: selected.version })
      });
      setTransitionTo('');
      await load();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const nextStatuses = selected ? (NEXT_STATUS[selected.status] || []) : [];
  const canBind = Boolean(eligibility && eligibility.bindable && selected && selected.status === 'PLACED');
  const bound = Boolean(selected && BOUND_STATUSES.has(selected.status));

  const currency = (selected && selected.currency) || 'USD';
  const towerLimit = sumBy(summary.layers, (layer) => layer.limitAmount);
  const cededPremium = sumBy(summary.cessions, (cession) => cession.cededPremiumAmount);
  const cededLoss = sumBy(summary.cessions, (cession) => cession.cededLossAmount);
  const riskBearingParticipants = summary.participants.filter(
    (participant) => participant.status === 'ACTIVE' && RISK_BEARING.has(participant.participantRole)
  );
  const riskBearingShare = sumBy(riskBearingParticipants, (participant) => participant.sharePct);
  const shareBalanced = Math.abs(riskBearingShare - 100) <= 0.0001;

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Reinsurance · Assumed book</div>
          <h1>Contract</h1>
          <p className="subtitle">Assumed reinsurance treaties, facultative placements, and their lifecycle.</p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge assumed" data-testid="book-badge">ASSUMED book</span>
          <button type="button" className="eia-btn-ghost" onClick={reloadWorkspace}>
            Refresh
          </button>
          <button type="button" aria-expanded={showCreate} onClick={() => setShowCreate((value) => !value)}>
            Create contract
          </button>
        </div>
      </header>

      {error && <p role="alert">{error}</p>}

      {showCreate && (
        <section className="eia-card" aria-label="Create contract" style={{ marginBottom: 16 }}>
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h2>New assumed contract</h2>
            <button type="button" className="eia-btn-ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
          <form className="eia-form-grid" onSubmit={submit}>
            <div className="eia-field span-2">
              <label htmlFor="contract-number">Contract number</label>
              <input
                id="contract-number"
                placeholder="XOL-2026-00001"
                value={form.contractNumber}
                onChange={(e) => update('contractNumber', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="contract-type">Contract type</label>
              <select
                id="contract-type"
                value={form.contractType}
                onChange={(e) => update('contractType', e.target.value)}
              >
                {CONTRACT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="eia-field">
              <label htmlFor="cedent-party">Cedent party id</label>
              <input
                id="cedent-party"
                placeholder="Cedent party id"
                value={form.cedentPartyId}
                onChange={(e) => update('cedentPartyId', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="reinsurer-party">Reinsurer party id</label>
              <input
                id="reinsurer-party"
                placeholder="Reinsurer party id"
                value={form.reinsurerPartyId}
                onChange={(e) => update('reinsurerPartyId', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="effective-date">Effective date</label>
              <input
                id="effective-date"
                type="date"
                value={form.effectiveDate}
                onChange={(e) => update('effectiveDate', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="expiration-date">Expiration date</label>
              <input
                id="expiration-date"
                type="date"
                value={form.expirationDate}
                onChange={(e) => update('expirationDate', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="contract-currency">Currency</label>
              <input
                id="contract-currency"
                placeholder="USD"
                maxLength={3}
                value={form.currency}
                onChange={(e) => update('currency', e.target.value.toUpperCase())}
                required
              />
            </div>
            <div className="eia-field">
              <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft contract'}</button>
            </div>
          </form>
        </section>
      )}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Contract register">
          <div className="eia-record-list-head">
            <strong>Contract register</strong>
            <span className="eia-muted">{contracts.length}</span>
          </div>
          {contracts.map((contract) => {
            const isSelected = contract.id === selectedId;
            return (
              <button
                key={contract.id}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-pressed={isSelected}
                onClick={() => selectContract(contract)}
              >
                <span className="record-primary">{contract.contractNumber}</span>
                <span className="record-secondary">
                  Cedent {contract.cedentDisplayName || shortId(contract.cedentPartyId)}
                </span>
                <span className="record-secondary">
                  Reinsurer {contract.reinsurerDisplayName || shortId(contract.reinsurerPartyId)}
                </span>
                <span>
                  <span className={`eia-pill ${statusTone(contract.status)}`}>{contract.status}</span>
                </span>
              </button>
            );
          })}
          {contracts.length === 0 && (
            <div className="empty">No contracts yet. Use Create contract to open the first record.</div>
          )}
        </aside>

        <section className="eia-record-panel" aria-label="Selected contract">
          {!selected ? (
            <div className="eia-empty">
              Select a contract from the register, or create a draft contract to start a new assumed placement.
            </div>
          ) : (
            <>
              <div className="eia-record-title">
                <div>
                  <h2>{selected.contractNumber}</h2>
                  <p className="eia-record-subtitle">
                    {selected.contractType}
                    {' · '}
                    {selected.effectiveDate || '—'} → {selected.expirationDate || '—'}
                    {' · '}
                    {selected.currency || '—'}
                    {' · version '}
                    {selected.version ?? '—'}
                  </p>
                </div>
                <div className="eia-actions">
                  <span
                    className={`eia-pill ${statusTone(selected.status)}`}
                    data-testid="contract-status"
                  >
                    {selected.status}
                  </span>
                  <span
                    className={`eia-badge ${bound ? 'ok' : 'warn'}`}
                    data-testid="contract-bound-state"
                  >
                    {bound ? 'Bound' : 'Unbound'}
                  </span>
                  <button type="button" onClick={bind} disabled={!canBind || binding}>
                    {binding ? 'Binding…' : 'Bind contract'}
                  </button>
                </div>
              </div>

              {bindMessage && <p role="status">{bindMessage}</p>}

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Tower limit</h3>
                  <div className="value" data-testid="summary-limit">
                    {summary.layers.length ? money(towerLimit, currency) : '—'}
                  </div>
                  <div className="eia-metric-label">
                    {summary.layers.length} layer{summary.layers.length === 1 ? '' : 's'} attached
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Ceded premium</h3>
                  <div className="value" data-testid="summary-ceded-premium">
                    {summary.cessions.length ? money(cededPremium, currency) : '—'}
                  </div>
                  <div className="eia-metric-label">
                    {summary.cessions.length} cession{summary.cessions.length === 1 ? '' : 's'} recorded
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Ceded loss</h3>
                  <div className="value" data-testid="summary-ceded-loss">
                    {summary.cessions.length ? money(cededLoss, currency) : '—'}
                  </div>
                  <div className="eia-metric-label">against the contract tower</div>
                </div>
                <div className="eia-card">
                  <h3>Participant share</h3>
                  <div className="value" data-testid="summary-share">
                    {riskBearingParticipants.length ? `${riskBearingShare.toFixed(2)}%` : '—'}
                  </div>
                  <div className="eia-metric-label">
                    {riskBearingParticipants.length
                      ? (shareBalanced ? 'risk-bearing shares balanced' : 'risk-bearing shares not balanced')
                      : 'no risk-bearing shares recorded'}
                  </div>
                </div>
              </div>

              <nav className="eia-tabs" aria-label="Contract sections">
                {TABS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`eia-tab${tab === name ? ' active' : ''}`}
                    aria-pressed={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </nav>

              {tab === 'Overview' && (
                <div className="eia-grid eia-grid-2">
                  <section className="eia-card" aria-label="Contract details">
                    <h3>Contract details</h3>
                    <dl className="eia-kv" style={{ marginTop: 8 }}>
                      <dt>Contract number</dt>
                      <dd className="eia-mono">{selected.contractNumber}</dd>
                      <dt>Contract type</dt>
                      <dd>{selected.contractType}</dd>
                      <dt>Cedent</dt>
                      <dd>{selected.cedentDisplayName || shortId(selected.cedentPartyId)}</dd>
                      <dt>Reinsurer</dt>
                      <dd>{selected.reinsurerDisplayName || shortId(selected.reinsurerPartyId)}</dd>
                      <dt>Effective</dt>
                      <dd>{selected.effectiveDate || '—'}</dd>
                      <dt>Expiration</dt>
                      <dd>{selected.expirationDate || '—'}</dd>
                      <dt>Currency</dt>
                      <dd>{selected.currency || '—'}</dd>
                      <dt>Version</dt>
                      <dd>{selected.version ?? '—'}</dd>
                    </dl>
                  </section>

                  <section className="eia-card" aria-label="Bind readiness">
                    <h3>Bind readiness</h3>
                    {eligibilityError && <p role="alert">{eligibilityError}</p>}
                    {eligibility ? (
                      <>
                        <p className="eia-muted" style={{ marginTop: 6 }}>
                          {eligibility.bindable
                            ? 'All checks passed. The contract can be bound.'
                            : 'Bind is blocked until every check passes.'}
                        </p>
                        <ul className="eia-list" aria-label="Bind checks">
                          {(eligibility.checks || []).map((check) => (
                            <li key={check.code}>
                              <span>
                                <span className={`eia-pill ${check.passed ? 'green' : 'red'}`}>
                                  {check.passed ? 'PASS' : 'FAIL'}
                                </span>{' '}
                                <span className="eia-mono">{check.code}</span>
                              </span>
                              <span className="eia-muted">{check.detail}</span>
                            </li>
                          ))}
                          {(!eligibility.checks || eligibility.checks.length === 0) && (
                            <li><span className="eia-muted">No bind checks reported.</span></li>
                          )}
                        </ul>
                      </>
                    ) : (
                      !eligibilityError && <p className="eia-muted">Loading bind checks…</p>
                    )}
                  </section>

                  <section className="eia-card" aria-label="Lifecycle">
                    <h3>Lifecycle</h3>
                    <p className="eia-muted" style={{ marginTop: 6 }}>
                      {nextStatuses.length
                        ? `Next allowed states from ${selected.status}.`
                        : `No further transitions from ${selected.status}.`}
                    </p>
                    {nextStatuses.length > 0 && (
                      <div className="eia-form-grid" style={{ marginTop: 6 }}>
                        <div className="eia-field">
                          <label htmlFor="transition-status">Transition to</label>
                          <select
                            id="transition-status"
                            value={transitionTo}
                            onChange={(e) => setTransitionTo(e.target.value)}
                          >
                            <option value="">—</option>
                            {nextStatuses.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </div>
                        <div className="eia-field">
                          <button
                            type="button"
                            className="eia-btn-secondary"
                            onClick={transition}
                            disabled={!transitionTo}
                          >
                            Apply transition
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {tab === 'Layers' && (
                <ResourceSection
                  title="Layers"
                  description="The contract tower: attachment, limit, basis, and effective dates."
                  resource="layers"
                  contractId={selectedId}
                  testId="layers-panel"
                  onChanged={refresh}
                  columns={[
                    { key: 'layerNumber', label: '#' },
                    { key: 'layerType', label: 'Type' },
                    { key: 'attachmentAmount', label: 'Attachment' },
                    { key: 'limitAmount', label: 'Limit' },
                    { key: 'currency', label: 'Currency' },
                    { key: 'limitBasis', label: 'Limit basis' },
                    { key: 'status', label: 'Status' }
                  ]}
                  fields={[
                    { name: 'layerNumber', label: 'Layer number', type: 'number', required: true },
                    { name: 'layerType', label: 'Layer type', type: 'select', options: LAYER_TYPES, defaultValue: 'EXCESS_OF_LOSS', required: true },
                    { name: 'attachmentAmount', label: 'Attachment amount', placeholder: '1000000', required: true },
                    { name: 'limitAmount', label: 'Limit amount', placeholder: '1000000', required: true },
                    { name: 'limitBasis', label: 'Limit basis', type: 'select', options: LIMIT_BASES, defaultValue: 'PER_OCCURRENCE', required: true },
                    { name: 'currency', label: 'Currency' },
                    { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
                    { name: 'effectiveTo', label: 'Effective to', type: 'date' },
                    { name: 'note', label: 'Tower note' }
                  ]}
                />
              )}

              {tab === 'Participants' && (
                <ParticipantsPanel contractId={selectedId} onChanged={refresh} />
              )}

              {tab === 'Terms' && (
                <ResourceSection
                  title="Terms"
                  description="Contract terms required before bind, with the clause they come from."
                  resource="terms"
                  contractId={selectedId}
                  testId="terms-panel"
                  onChanged={refresh}
                  columns={[
                    { key: 'termCode', label: 'Term' },
                    { key: 'termValue', label: 'Value' },
                    { key: 'valueType', label: 'Type' },
                    { key: 'effectiveFrom', label: 'Effective from' },
                    { key: 'sourceClause', label: 'Source clause' }
                  ]}
                  fields={[
                    { name: 'termCode', label: 'Term code', type: 'select', options: TERM_CODES, defaultValue: 'GOVERNING_LAW', required: true },
                    { name: 'termValue', label: 'Term value', placeholder: 'New York', required: true },
                    { name: 'sourceClause', label: 'Source clause', type: 'select', options: CLAUSE_CODES },
                    { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
                    { name: 'effectiveTo', label: 'Effective to', type: 'date' }
                  ]}
                />
              )}

              {tab === 'Security' && (
                <ResourceSection
                  title="Security"
                  description="Collateral held against the reinsurer's obligations."
                  resource="security"
                  contractId={selectedId}
                  testId="security-panel"
                  onChanged={refresh}
                  transform={(payload) => {
                    if (payload.approvalRef && !payload.approvedAt) {
                      return { ...payload, approvedAt: new Date().toISOString() };
                    }
                    return payload;
                  }}
                  columns={[
                    { key: 'securityType', label: 'Type' },
                    { key: 'requiredAmount', label: 'Required' },
                    { key: 'heldAmount', label: 'Held' },
                    { key: 'currency', label: 'Currency' },
                    { key: 'expiryDate', label: 'Expiry' },
                    { key: 'status', label: 'Status' }
                  ]}
                  fields={[
                    { name: 'securityType', label: 'Security type', type: 'select', options: SECURITY_TYPES, defaultValue: 'LETTER_OF_CREDIT', required: true },
                    { name: 'requiredAmount', label: 'Required amount', placeholder: '5000000', required: true },
                    { name: 'heldAmount', label: 'Held amount', placeholder: '5000000' },
                    { name: 'currency', label: 'Currency' },
                    { name: 'providerPartyId', label: 'Provider party id' },
                    { name: 'expiryDate', label: 'Expiry date', type: 'date' },
                    { name: 'approvalRef', label: 'Approval reference' }
                  ]}
                />
              )}

              {tab === 'Cessions' && (
                <CessionsPanel contractId={selectedId} onChanged={refresh} />
              )}

              {tab === 'Bordereaux' && (
                <ResourceSection
                  title="Bordereaux"
                  description="Cedent bordereaux received for the contract."
                  resource="bordereaux"
                  contractId={selectedId}
                  testId="bordereaux-panel"
                  onChanged={refresh}
                  columns={[
                    { key: 'bordereauNumber', label: 'Number' },
                    { key: 'bordereauType', label: 'Type' },
                    { key: 'periodFrom', label: 'Period from' },
                    { key: 'periodTo', label: 'Period to' },
                    { key: 'lineCount', label: 'Lines' },
                    { key: 'totalAmount', label: 'Total' },
                    { key: 'status', label: 'Status' }
                  ]}
                  fields={[
                    { name: 'bordereauType', label: 'Bordereau type', type: 'select', options: BORDEREAU_TYPES, defaultValue: 'CLAIMS', required: true },
                    { name: 'periodFrom', label: 'Period from', type: 'date', required: true },
                    { name: 'periodTo', label: 'Period to', type: 'date', required: true },
                    { name: 'sourceFormat', label: 'Source format', type: 'select', options: SOURCE_FORMATS, defaultValue: 'CSV', required: true },
                    { name: 'lineCount', label: 'Line count', type: 'number' },
                    { name: 'validLineCount', label: 'Valid line count', type: 'number' },
                    { name: 'exceptionCount', label: 'Exception count', type: 'number' },
                    { name: 'totalAmount', label: 'Total amount' },
                    { name: 'sourceReference', label: 'Source reference' }
                  ]}
                />
              )}

              {tab === 'Commutation' && (
                <ResourceSection
                  title="Commutations"
                  description="Propose, approve, and execute a commutation. Execution closes a FULL commutation."
                  resource="commutations"
                  contractId={selectedId}
                  testId="commutation-panel"
                  onChanged={refresh}
                  columns={[
                    { key: 'commutationNumber', label: 'Number' },
                    { key: 'commutationType', label: 'Type' },
                    { key: 'agreedAmount', label: 'Agreed amount' },
                    { key: 'effectiveDate', label: 'Effective' },
                    { key: 'status', label: 'Status' }
                  ]}
                  fields={[
                    { name: 'commutationType', label: 'Commutation type', type: 'select', options: COMMUTATION_TYPES, defaultValue: 'FULL', required: true },
                    { name: 'effectiveDate', label: 'Effective date', type: 'date', required: true },
                    { name: 'valuationDate', label: 'Valuation date', type: 'date', required: true },
                    { name: 'agreedAmount', label: 'Agreed amount', placeholder: '2650000', required: true },
                    { name: 'savingsAmount', label: 'Savings amount' },
                    { name: 'basis', label: 'Basis', type: 'select', options: COMMUTATION_BASES, defaultValue: 'NEGOTIATED' },
                    { name: 'releaseDocumentId', label: 'Release document id' }
                  ]}
                  rowActions={(row, reload, onRowError) => (
                    <span style={{ display: 'flex', gap: 6 }}>
                      {row.status === 'PROPOSED' && (
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/v1/contracts/${selectedId}/commutations/${row.id}/approve`, {
                                method: 'POST',
                                body: JSON.stringify({ approvedBy: APPROVER })
                              });
                              await reload();
                            } catch (e) {
                              onRowError(e);
                            }
                          }}
                        >
                          Approve
                        </button>
                      )}
                      {row.status === 'APPROVED' && (
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/v1/contracts/${selectedId}/commutations/${row.id}/execute`, {
                                method: 'POST',
                                body: JSON.stringify(row.releaseDocumentId ? { releaseDocumentId: row.releaseDocumentId } : {})
                              });
                              await reload();
                              refresh();
                            } catch (e) {
                              onRowError(e);
                            }
                          }}
                        >
                          Execute
                        </button>
                      )}
                    </span>
                  )}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
