import React, { useEffect, useState } from 'react';
import { apiFetch, errorMessage, APPROVER } from './api';
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

const TABS = [
  'Contracts',
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

function errorMessageFrom(payload, fallback) {
  if (payload && typeof payload.message === 'string') {
    return `${payload.code || 'ERROR'}: ${payload.message}`;
  }
  return fallback;
}

export default function App() {
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Contracts');
  const [selectedId, setSelectedId] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [bindMessage, setBindMessage] = useState('');
  const [binding, setBinding] = useState(false);
  const [transitionTo, setTransitionTo] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  const selected = contracts.find((contract) => contract.id === selectedId) || null;

  async function load() {
    const response = await fetch('/api/v1/contracts', { headers: { 'X-EIA-Tenant': '11111111-1111-7111-8111-111111111111' } });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    setContracts(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
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

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': '11111111-1111-7111-8111-111111111111' },
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessageFrom(payload, `Create failed: ${response.status}`));
        return;
      }
      setForm(EMPTY_FORM);
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
    setTab('Layers');
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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Contract</h1>
      <p>Assumed reinsurance treaties, facultative placements, and their lifecycle.</p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}

      <nav aria-label="Contract sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0' }}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
            style={{ fontWeight: tab === name ? 700 : 400 }}
          >
            {name}
          </button>
        ))}
      </nav>

      {selected && (
        <section aria-label="Selected contract" style={{ border: '1px solid #ddd', padding: 12, marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>{selected.contractNumber}</h2>
          <p>
            Status: <strong>{selected.status}</strong> · version {selected.version} · {selected.currency}
          </p>
          {eligibilityError && <p role="alert" style={{ color: '#b00020' }}>{eligibilityError}</p>}
          {eligibility && (
            <ul aria-label="Bind checks" style={{ paddingLeft: 18 }}>
              {eligibility.checks.map((check) => (
                <li key={check.code} style={{ color: check.passed ? '#0b6b3a' : '#b00020' }}>
                  {check.passed ? 'PASS' : 'FAIL'} {check.code}: {check.detail}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={bind} disabled={!canBind || binding}>
            {binding ? 'Binding…' : 'Bind contract'}
          </button>
          {bindMessage && <p role="status" style={{ color: '#0b6b3a' }}>{bindMessage}</p>}
          {nextStatuses.length > 0 && (
            <p>
              <label>
                Transition to{' '}
                <select
                  aria-label="Transition to"
                  value={transitionTo}
                  onChange={(e) => setTransitionTo(e.target.value)}
                >
                  <option value="">—</option>
                  {nextStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>{' '}
              <button type="button" onClick={transition} disabled={!transitionTo}>Apply transition</button>
            </p>
          )}
        </section>
      )}

      {tab === 'Contracts' && (
        <section aria-label="Contracts">
          <form onSubmit={submit} style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
            <input
              aria-label="Contract number"
              placeholder="Contract number (XOL-2026-00001)"
              value={form.contractNumber}
              onChange={(e) => update('contractNumber', e.target.value)}
              required
            />
            <select
              aria-label="Contract type"
              value={form.contractType}
              onChange={(e) => update('contractType', e.target.value)}
            >
              {CONTRACT_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <input
              aria-label="Cedent party id"
              placeholder="Cedent party id"
              value={form.cedentPartyId}
              onChange={(e) => update('cedentPartyId', e.target.value)}
              required
            />
            <input
              aria-label="Reinsurer party id"
              placeholder="Reinsurer party id"
              value={form.reinsurerPartyId}
              onChange={(e) => update('reinsurerPartyId', e.target.value)}
              required
            />
            <label>
              Effective date
              <input
                aria-label="Effective date"
                type="date"
                value={form.effectiveDate}
                onChange={(e) => update('effectiveDate', e.target.value)}
                required
              />
            </label>
            <label>
              Expiration date
              <input
                aria-label="Expiration date"
                type="date"
                value={form.expirationDate}
                onChange={(e) => update('expirationDate', e.target.value)}
                required
              />
            </label>
            <input
              aria-label="Currency"
              placeholder="Currency (USD)"
              maxLength={3}
              value={form.currency}
              onChange={(e) => update('currency', e.target.value.toUpperCase())}
              required
            />
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft contract'}</button>
          </form>
          <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Number</th>
                <th align="left">Type</th>
                <th align="left">Status</th>
                <th align="left">Effective</th>
                <th align="left">Expiration</th>
                <th align="left">Currency</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} style={{ borderTop: '1px solid #ddd' }}>
                  <td>{contract.contractNumber}</td>
                  <td>{contract.contractType}</td>
                  <td>{contract.status}</td>
                  <td>{contract.effectiveDate}</td>
                  <td>{contract.expirationDate}</td>
                  <td>{contract.currency}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => selectContract(contract)}
                    >
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
    </main>
  );
}
