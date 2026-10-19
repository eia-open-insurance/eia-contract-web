import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

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

const EMPTY_FORM = {
  contractNumber: '',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: '44444444-4444-7444-8444-444444444444',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD'
};

function errorMessage(payload, fallback) {
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

  async function load() {
    const response = await fetch('/api/v1/contracts', { headers: { 'X-EIA-Tenant': TENANT } });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    setContracts(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

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
        setError(errorMessage(payload, `Create failed: ${response.status}`));
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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1>Contract</h1>
      <p>Assumed reinsurance treaties, facultative placements, and their lifecycle.</p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
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
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
