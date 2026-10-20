import React, { useEffect, useState } from 'react';
import { apiFetch, errorMessage, formatValue } from './api';

const RISK_BEARING = new Set(['REINSURER', 'LEAD', 'FOLLOW', 'FRONTING', 'RETROCESSIONAIRE']);
const ROLES = ['REINSURER', 'LEAD', 'FOLLOW', 'FRONTING', 'RETROCESSIONAIRE', 'CEDENT', 'BROKER'];
const SIGNATURE_STATUSES = ['PENDING', 'SIGNED', 'DECLINED', 'WITHDRAWN'];

const EMPTY = {
  layerId: '',
  partyId: '',
  participantRole: 'REINSURER',
  sharePct: '',
  leadFlag: false,
  signatureStatus: 'PENDING'
};

/** Participants tab: records participations and shows the 100% balance per layer. */
export default function ParticipantsPanel({ contractId, onChanged }) {
  const [layers, setLayers] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!contractId) {
      setLayers([]);
      setParticipants([]);
      return;
    }
    try {
      const [layerRows, participantRows] = await Promise.all([
        apiFetch(`/api/v1/contracts/${contractId}/layers`),
        apiFetch(`/api/v1/contracts/${contractId}/participants`)
      ]);
      setLayers(layerRows || []);
      setParticipants(participantRows || []);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, [contractId]);

  const totals = new Map();
  for (const participant of participants) {
    if (participant.status !== 'ACTIVE' || !RISK_BEARING.has(participant.participantRole)) {
      continue;
    }
    const key = participant.layerId || 'contract';
    totals.set(key, (totals.get(key) || 0) + Number(participant.sharePct || 0));
  }

  function labelFor(layerKey) {
    if (layerKey === 'contract') {
      return 'Contract level';
    }
    const layer = layers.find((candidate) => candidate.id === layerKey);
    return layer ? `Layer ${layer.layerNumber}` : `Layer ${layerKey}`;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        partyId: form.partyId,
        participantRole: form.participantRole,
        sharePct: form.sharePct,
        leadFlag: form.leadFlag,
        signatureStatus: form.signatureStatus
      };
      if (form.layerId) {
        payload.layerId = form.layerId;
      }
      await apiFetch(`/api/v1/contracts/${contractId}/participants`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setForm(EMPTY);
      setMessage('Participation recorded.');
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
      <section aria-label="Participants">
        <div className="eia-section-title">
          <h2>Participants</h2>
        </div>
        <div className="eia-empty">Select a contract from the register to work with its participants.</div>
      </section>
    );
  }

  return (
    <section aria-label="Participants" data-testid="participants-panel">
      <div className="eia-section-title">
        <h2>Participants</h2>
        <span className="eia-muted">
          {participants.length} record{participants.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="eia-muted">Reinsurers and their shares. Risk-bearing shares must total 100% before bind.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <form className="eia-form-grid" onSubmit={submit} style={{ margin: '12px 0 16px' }}>
        <div className="eia-field">
          <label htmlFor="participant-layer">Layer</label>
          <select
            id="participant-layer"
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
          <label htmlFor="participant-party">Party id</label>
          <input
            id="participant-party"
            placeholder="Reinsurer party id"
            value={form.partyId}
            onChange={(e) => setForm({ ...form, partyId: e.target.value })}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="participant-role">Role</label>
          <select
            id="participant-role"
            value={form.participantRole}
            onChange={(e) => setForm({ ...form, participantRole: e.target.value })}
          >
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="participant-share">Share percent</label>
          <input
            id="participant-share"
            placeholder="60.000000"
            value={form.sharePct}
            onChange={(e) => setForm({ ...form, sharePct: e.target.value })}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="participant-signature">Signature status</label>
          <select
            id="participant-signature"
            value={form.signatureStatus}
            onChange={(e) => setForm({ ...form, signatureStatus: e.target.value })}
          >
            {SIGNATURE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="participant-lead">Lead participant</label>
          <input
            id="participant-lead"
            type="checkbox"
            checked={form.leadFlag}
            onChange={(e) => setForm({ ...form, leadFlag: e.target.checked })}
            style={{ width: 'auto' }}
          />
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add participant'}</button>
        </div>
      </form>

      <div className="eia-card" style={{ marginBottom: 14 }}>
        <h3>Share balance</h3>
        <p aria-live="polite" data-testid="share-totals" style={{ margin: 0 }}>
          {[...totals.entries()].map(([layerKey, total]) => {
            const balanced = Math.abs(total - 100) <= 0.0001;
            return (
              <span
                key={layerKey}
                className={`eia-badge ${balanced ? 'ok' : 'warn'}`}
                style={{ marginRight: 6, marginBottom: 4 }}
              >
                {labelFor(layerKey)} total: {total.toFixed(6)}% ({balanced ? 'balanced' : 'not balanced'})
              </span>
            );
          })}
          {totals.size === 0 && <span className="eia-muted">No risk-bearing shares recorded.</span>}
        </p>
      </div>

      <div className="eia-table-wrap">
        <table className="eia-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Party</th>
              <th>Layer</th>
              <th>Share %</th>
              <th>Signature</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((participant) => (
              <tr key={participant.id}>
                <td>{participant.participantRole}</td>
                <td className="eia-mono">{participant.partyId}</td>
                <td>{participant.layerId ? labelFor(participant.layerId) : 'Contract level'}</td>
                <td>{formatValue(participant.sharePct)}</td>
                <td>{participant.signatureStatus}</td>
                <td>{participant.status}</td>
              </tr>
            ))}
            {participants.length === 0 && (
              <tr><td className="eia-muted" colSpan={6}>No participations yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
