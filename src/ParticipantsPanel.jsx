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
        <h2>Participants</h2>
        <p>Select a contract on the Contracts tab to work with its participants.</p>
      </section>
    );
  }

  return (
    <section aria-label="Participants" data-testid="participants-panel">
      <h2>Participants</h2>
      <p>Reinsurers and their shares. Risk-bearing shares must total 100% before bind.</p>
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      {message && <p role="status" style={{ color: '#0b6b3a' }}>{message}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, margin: '12px 0 20px', maxWidth: 680 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Layer</span>
          <select
            aria-label="Layer"
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
          <span>Party id</span>
          <input
            aria-label="Party id"
            placeholder="Reinsurer party id"
            value={form.partyId}
            onChange={(e) => setForm({ ...form, partyId: e.target.value })}
            required
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Role</span>
          <select
            aria-label="Role"
            value={form.participantRole}
            onChange={(e) => setForm({ ...form, participantRole: e.target.value })}
          >
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Share percent</span>
          <input
            aria-label="Share percent"
            placeholder="60.000000"
            value={form.sharePct}
            onChange={(e) => setForm({ ...form, sharePct: e.target.value })}
            required
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Signature status</span>
          <select
            aria-label="Signature status"
            value={form.signatureStatus}
            onChange={(e) => setForm({ ...form, signatureStatus: e.target.value })}
          >
            {SIGNATURE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            aria-label="Lead participant"
            type="checkbox"
            checked={form.leadFlag}
            onChange={(e) => setForm({ ...form, leadFlag: e.target.checked })}
          />
          <span>Lead participant</span>
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add participant'}</button>
      </form>
      <p aria-live="polite" data-testid="share-totals">
        {[...totals.entries()].map(([layerKey, total]) => {
          const balanced = Math.abs(total - 100) <= 0.0001;
          return (
            <span key={layerKey} style={{ display: 'block', color: balanced ? '#0b6b3a' : '#b00020' }}>
              {labelFor(layerKey)} total: {total.toFixed(6)}% ({balanced ? 'balanced' : 'not balanced'})
            </span>
          );
        })}
        {totals.size === 0 && <span>No risk-bearing shares recorded.</span>}
      </p>
      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Role</th>
            <th align="left">Party</th>
            <th align="left">Layer</th>
            <th align="left">Share %</th>
            <th align="left">Signature</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => (
            <tr key={participant.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{participant.participantRole}</td>
              <td>{participant.partyId}</td>
              <td>{participant.layerId ? labelFor(participant.layerId) : 'Contract level'}</td>
              <td>{formatValue(participant.sharePct)}</td>
              <td>{participant.signatureStatus}</td>
              <td>{participant.status}</td>
            </tr>
          ))}
          {participants.length === 0 && (
            <tr><td colSpan={6}>No participations yet.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
