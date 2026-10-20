import React, { useEffect, useState } from 'react';
import { apiFetch, errorMessage, formatValue } from './api';

const CESSION_TYPES = ['QUOTA_SHARE', 'SURPLUS', 'FACULTATIVE', 'EXCESS_OF_LOSS', 'AGGREGATE', 'RETROCESSION'];
const SOURCE_TYPES = ['CLAIM', 'POLICY', 'LOSS_ADVICE'];

const EMPTY = {
  layerId: '',
  sourceType: 'CLAIM',
  claimRef: '',
  policyRef: '',
  cessionType: 'QUOTA_SHARE',
  cessionPct: '',
  cededPremiumAmount: '',
  cededLossAmount: ''
};

/** Cessions tab: records a cession and surfaces the capacity/book-wall rejections. */
export default function CessionsPanel({ contractId, onChanged }) {
  const [layers, setLayers] = useState([]);
  const [cessions, setCessions] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!contractId) {
      setLayers([]);
      setCessions([]);
      return;
    }
    try {
      const [layerRows, cessionRows] = await Promise.all([
        apiFetch(`/api/v1/contracts/${contractId}/layers`),
        apiFetch(`/api/v1/contracts/${contractId}/cessions`)
      ]);
      setLayers(layerRows || []);
      setCessions(cessionRows || []);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, [contractId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {};
      for (const [key, value] of Object.entries(form)) {
        if (value !== '' && value !== undefined && value !== null) {
          payload[key] = key === 'treatyYear' ? Number(value) : value;
        }
      }
      await apiFetch(`/api/v1/contracts/${contractId}/cessions`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setForm(EMPTY);
      setMessage('Cession recorded.');
      await load();
      if (onChanged) {
        onChanged();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!contractId) {
    return (
      <section aria-label="Cessions">
        <div className="eia-section-title">
          <h2>Cessions</h2>
        </div>
        <div className="eia-empty">Select a contract from the register to work with its cessions.</div>
      </section>
    );
  }

  const bookedLoss = cessions
    .filter((cession) => ['RECORDED', 'CONFIRMED'].includes(cession.status))
    .reduce((total, cession) => total + Number(cession.cededLossAmount || 0), 0);

  return (
    <section aria-label="Cessions" data-testid="cessions-panel">
      <div className="eia-section-title">
        <h2>Cessions</h2>
        <span className="eia-muted">
          {cessions.length} record{cessions.length === 1 ? '' : 's'} · booked loss{' '}
          {bookedLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="eia-muted">Recorded cessions may not exceed the contract tower capacity.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <form className="eia-form-grid" onSubmit={submit} style={{ margin: '12px 0 16px' }}>
        <div className="eia-field">
          <label htmlFor="cession-layer">Cession layer</label>
          <select
            id="cession-layer"
            value={form.layerId}
            onChange={(e) => setForm({ ...form, layerId: e.target.value })}
          >
            <option value="">Contract level</option>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>Layer {layer.layerNumber}</option>
            ))}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="cession-source-type">Source type</label>
          <select
            id="cession-source-type"
            value={form.sourceType}
            onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
          >
            {SOURCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="cession-claim-ref">Claim reference</label>
          <input
            id="cession-claim-ref"
            placeholder="CLM-2026-0007"
            value={form.claimRef}
            onChange={(e) => setForm({ ...form, claimRef: e.target.value })}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cession-policy-ref">Policy reference</label>
          <input
            id="cession-policy-ref"
            placeholder="POL-2026-0001"
            value={form.policyRef}
            onChange={(e) => setForm({ ...form, policyRef: e.target.value })}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cession-type">Cession type</label>
          <select
            id="cession-type"
            value={form.cessionType}
            onChange={(e) => setForm({ ...form, cessionType: e.target.value })}
          >
            {CESSION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="cession-pct">Cession percent</label>
          <input
            id="cession-pct"
            placeholder="40"
            value={form.cessionPct}
            onChange={(e) => setForm({ ...form, cessionPct: e.target.value })}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cession-ceded-premium">Ceded premium</label>
          <input
            id="cession-ceded-premium"
            placeholder="400000.0000"
            value={form.cededPremiumAmount}
            onChange={(e) => setForm({ ...form, cededPremiumAmount: e.target.value })}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cession-ceded-loss">Ceded loss</label>
          <input
            id="cession-ceded-loss"
            placeholder="240000.0000"
            value={form.cededLossAmount}
            onChange={(e) => setForm({ ...form, cededLossAmount: e.target.value })}
          />
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record cession'}</button>
        </div>
      </form>

      <div className="eia-table-wrap">
        <table className="eia-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Source</th>
              <th>Reference</th>
              <th>Ceded premium</th>
              <th>Ceded loss</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {cessions.map((cession) => (
              <tr key={cession.id}>
                <td className="eia-mono">{cession.cessionNumber}</td>
                <td>{cession.sourceType}</td>
                <td>{cession.claimRef || cession.policyRef}</td>
                <td>{formatValue(cession.cededPremiumAmount)}</td>
                <td>{formatValue(cession.cededLossAmount)}</td>
                <td>{cession.status}</td>
              </tr>
            ))}
            {cessions.length === 0 && (
              <tr><td className="eia-muted" colSpan={6}>No cessions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
