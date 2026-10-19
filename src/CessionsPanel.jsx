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
        <h2>Cessions</h2>
        <p>Select a contract on the Contracts tab to work with its cessions.</p>
      </section>
    );
  }

  return (
    <section aria-label="Cessions" data-testid="cessions-panel">
      <h2>Cessions</h2>
      <p>Recorded cessions may not exceed the contract tower capacity.</p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      {message && <p role="status" style={{ color: '#0b6b3a' }}>{message}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, margin: '12px 0 20px', maxWidth: 680 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Layer</span>
          <select
            aria-label="Cession layer"
            value={form.layerId}
            onChange={(e) => setForm({ ...form, layerId: e.target.value })}
          >
            <option value="">Contract level</option>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>Layer {layer.layerNumber}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Source type</span>
          <select
            aria-label="Source type"
            value={form.sourceType}
            onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
          >
            {SOURCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Claim reference</span>
          <input
            aria-label="Claim reference"
            placeholder="CLM-2026-0007"
            value={form.claimRef}
            onChange={(e) => setForm({ ...form, claimRef: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Policy reference</span>
          <input
            aria-label="Policy reference"
            placeholder="POL-2026-0001"
            value={form.policyRef}
            onChange={(e) => setForm({ ...form, policyRef: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Cession type</span>
          <select
            aria-label="Cession type"
            value={form.cessionType}
            onChange={(e) => setForm({ ...form, cessionType: e.target.value })}
          >
            {CESSION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Cession percent</span>
          <input
            aria-label="Cession percent"
            placeholder="40"
            value={form.cessionPct}
            onChange={(e) => setForm({ ...form, cessionPct: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Ceded premium</span>
          <input
            aria-label="Ceded premium"
            placeholder="400000.0000"
            value={form.cededPremiumAmount}
            onChange={(e) => setForm({ ...form, cededPremiumAmount: e.target.value })}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Ceded loss</span>
          <input
            aria-label="Ceded loss"
            placeholder="240000.0000"
            value={form.cededLossAmount}
            onChange={(e) => setForm({ ...form, cededLossAmount: e.target.value })}
          />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record cession'}</button>
      </form>
      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Number</th>
            <th align="left">Source</th>
            <th align="left">Reference</th>
            <th align="left">Ceded premium</th>
            <th align="left">Ceded loss</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {cessions.map((cession) => (
            <tr key={cession.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{cession.cessionNumber}</td>
              <td>{cession.sourceType}</td>
              <td>{cession.claimRef || cession.policyRef}</td>
              <td>{formatValue(cession.cededPremiumAmount)}</td>
              <td>{formatValue(cession.cededLossAmount)}</td>
              <td>{cession.status}</td>
            </tr>
          ))}
          {cessions.length === 0 && (
            <tr><td colSpan={6}>No cessions yet.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
