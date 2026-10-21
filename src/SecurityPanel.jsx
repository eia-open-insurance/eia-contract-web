import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import { navigate } from './navigation';
import {
  SECURITY_STATUS,
  SECURITY_TYPES,
  buildCreatePayload,
  formatAmount,
  formatDate,
  securityActions,
  securityApprovalRef,
  securityCurrency,
  securityEndpoint,
  securityExpiryDate,
  securityHeldAmount,
  securityProviderPartyId,
  securityRequiredAmount,
  securityRowId,
  securityStatus,
  securityStatusEndpoint,
  securityType,
  statusPayload,
  statusTone,
  summarizeSecurity,
  validateCreateForm
} from './security';

function initialForm(currency) {
  return {
    securityType: 'LETTER_OF_CREDIT',
    requiredAmount: '',
    heldAmount: '',
    currency: currency || 'USD',
    providerPartyId: '',
    expiryDate: '',
    approvalRef: ''
  };
}

function shortId(value) {
  return value ? String(value).slice(0, 8) : '';
}

function spacedType(value) {
  return value ? value.replace(/_/g, ' ').toLowerCase() : 'security';
}

function confirmationFor(row, action, currency) {
  const label = spacedType(securityType(row));
  const held = formatAmount(securityHeldAmount(row), securityCurrency(row) || currency);
  if (action.status === SECURITY_STATUS.RELEASED) {
    return `Release ${label} collateral of ${held} for this contract?\n\nReleasing records the collateral as returned. Security is collateral, not cash: this does not create a Payment. Payment and FS-RI own execution.`;
  }
  return `Expire ${label} collateral of ${held} for this contract?\n\nExpiring records the collateral as lapsed. Security is collateral, not cash: this does not create a Payment. Payment and FS-RI own execution.`;
}

/**
 * Security tab: the collateral held against the selected contract.
 *
 * A security record is collateral, not cash and not a Payment. It starts ACTIVE
 * (or EXPIRED when the expiry date is already past) and can be released or
 * expired; both are terminal and neither creates a Payment. Every failure stays
 * inside this panel so the contract record always remains usable.
 */
export default function SecurityPanel({ contractId, currency = 'USD', onChanged }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(() => initialForm(currency));
  const [loading, setLoading] = useState(Boolean(contractId));
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!contractId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(securityEndpoint(contractId));
      const nextRows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setRows(nextRows);
      setLoadError('');
    } catch (error) {
      setRows([]);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(initialForm(currency));
    setMessage('');
    setActionError('');
    load();
  }, [contractId, currency]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setActionError('');
    const issues = validateCreateForm(form);
    if (issues.length > 0) {
      setActionError(issues.join(' '));
      return;
    }
    setBusy(true);
    try {
      await apiFetch(securityEndpoint(contractId), {
        method: 'POST',
        body: JSON.stringify(buildCreatePayload(form))
      });
      setMessage('Security recorded.');
      setForm(initialForm(currency));
      await load();
      if (onChanged) {
        onChanged();
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyAction(row, action) {
    if (!window.confirm(confirmationFor(row, action, currency))) {
      return;
    }
    const id = securityRowId(row);
    setMessage('');
    setActionError('');
    setActionBusy(id);
    try {
      await apiFetch(securityStatusEndpoint(contractId, id), {
        method: 'PATCH',
        body: JSON.stringify(statusPayload(action.status))
      });
      setMessage(`Security ${action.verb}.`);
      await load();
      if (onChanged) {
        onChanged();
      }
    } catch (error) {
      setActionError(errorMessage(error));
      if (error.status === 409) {
        await load();
      }
    } finally {
      setActionBusy('');
    }
  }

  const summary = useMemo(() => summarizeSecurity(rows), [rows]);

  const countValue = (value) => {
    if (loading) return '…';
    if (loadError) return '—';
    return String(value);
  };
  const amountValue = (value) => {
    if (loading) return '…';
    if (loadError || summary.count === 0) return '—';
    return formatAmount(value, currency);
  };
  const countLabel = loading
    ? '…'
    : loadError
      ? '—'
      : `${summary.count} security record${summary.count === 1 ? '' : 's'}`;
  const displayedError = loadError
    ? `Security could not be loaded (${loadError}). The contract record is unaffected.`
    : actionError;

  if (!contractId) {
    return (
      <section aria-label="Security" data-testid="security-panel">
        <div className="eia-section-title">
          <h2>Security</h2>
        </div>
        <div className="eia-empty">
          Select a contract from the register to work with its security.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Security" data-testid="security-panel">
      <div className="eia-section-title">
        <h2>Security</h2>
        <span className="eia-muted" data-testid="security-count">{countLabel}</span>
      </div>
      <p className="eia-muted">
        Collateral held against the reinsurer&apos;s obligations for this contract.
        Release it when it is returned, or expire it when it lapses.
      </p>

      <div className="eia-summary-grid">
        <div className="eia-card">
          <h3>Required total</h3>
          <div className="value" data-testid="security-summary-required">
            {amountValue(summary.requiredTotal)}
          </div>
          <div className="eia-metric-label">secured obligation across all records</div>
        </div>
        <div className="eia-card">
          <h3>Held total</h3>
          <div className="value" data-testid="security-summary-held">
            {amountValue(summary.heldTotal)}
          </div>
          <div className="eia-metric-label">collateral actually held</div>
        </div>
        <div className="eia-card">
          <h3>Outstanding</h3>
          <div className="value" data-testid="security-summary-outstanding">
            {amountValue(summary.outstanding)}
          </div>
          <div className="eia-metric-label">required minus held</div>
        </div>
        <div className="eia-card">
          <h3>Active</h3>
          <div className="value" data-testid="security-summary-active">
            {countValue(summary.activeCount)}
          </div>
          <div className="eia-metric-label">not released or expired</div>
        </div>
        <div className="eia-card">
          <h3>Released</h3>
          <div className="value" data-testid="security-summary-released">
            {countValue(summary.releasedCount)}
          </div>
          <div className="eia-metric-label">collateral returned</div>
        </div>
      </div>

      <div className="eia-context-panel" data-testid="security-context-note">
        <h4>Collateral, not cash</h4>
        <p>
          Security is collateral held against the reinsurer&apos;s obligations — a letter
          of credit, trust fund, funds withheld, guarantee, or similar instrument. It is
          not cash and it is not a Payment. Releasing or expiring a record does not
          create a Payment; Payment and FS-RI own execution.
        </p>
      </div>

      <form
        className="eia-form-grid"
        onSubmit={submit}
        aria-label="Record security"
        style={{ margin: '16px 0' }}
      >
        <div className="eia-field">
          <label htmlFor="security-type">Security type</label>
          <select
            id="security-type"
            value={form.securityType}
            onChange={(event) => update('securityType', event.target.value)}
            required
          >
            {SECURITY_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="eia-field">
          <label htmlFor="security-required-amount">Required amount</label>
          <input
            id="security-required-amount"
            type="number"
            min="0"
            step="0.0001"
            placeholder="5000000"
            value={form.requiredAmount}
            onChange={(event) => update('requiredAmount', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="security-held-amount">Held amount</label>
          <input
            id="security-held-amount"
            type="number"
            min="0"
            step="0.0001"
            placeholder="5000000"
            value={form.heldAmount}
            onChange={(event) => update('heldAmount', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="security-currency">Currency</label>
          <input
            id="security-currency"
            maxLength={3}
            value={form.currency}
            onChange={(event) => update('currency', event.target.value.toUpperCase())}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="security-provider-party-id">Provider party id</label>
          <input
            id="security-provider-party-id"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={form.providerPartyId}
            onChange={(event) => update('providerPartyId', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="security-expiry-date">Expiry date</label>
          <input
            id="security-expiry-date"
            type="date"
            value={form.expiryDate}
            onChange={(event) => update('expiryDate', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="security-approval-ref">Approval reference</label>
          <input
            id="security-approval-ref"
            maxLength={64}
            placeholder="LOC-2026-0001"
            value={form.approvalRef}
            onChange={(event) => update('approvalRef', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record security'}</button>
        </div>
      </form>

      {displayedError && (
        <p role="alert" data-testid="security-error">{displayedError}</p>
      )}
      {message && (
        <p role="status" data-testid="security-message">{message}</p>
      )}

      <div className="eia-table-wrap">
        <table className="eia-table" aria-label="Security">
          <thead>
            <tr>
              <th>Type</th>
              <th>Required</th>
              <th>Held</th>
              <th>Currency</th>
              <th>Provider</th>
              <th>Expiry</th>
              <th>Approval ref</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const id = securityRowId(row);
              const rowCurrency = securityCurrency(row) || currency;
              const status = securityStatus(row);
              const actions = securityActions(row);
              const provider = securityProviderPartyId(row);
              return (
                <tr key={id || `security-${index}`} data-testid="security-row">
                  <td data-testid="security-type">{securityType(row) || '—'}</td>
                  <td data-testid="security-required">
                    {formatAmount(securityRequiredAmount(row), rowCurrency)}
                  </td>
                  <td data-testid="security-held">
                    {formatAmount(securityHeldAmount(row), rowCurrency)}
                  </td>
                  <td data-testid="security-currency">{securityCurrency(row) || '—'}</td>
                  <td data-testid="security-provider" title={provider || undefined}>
                    {provider ? (
                      <a
                        href={`/party?record=${provider}`}
                        className="eia-mono"
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/party?record=${provider}`);
                        }}
                      >
                        {shortId(provider)}
                      </a>
                    ) : '—'}
                  </td>
                  <td data-testid="security-expiry">{formatDate(securityExpiryDate(row))}</td>
                  <td data-testid="security-approval-ref">{securityApprovalRef(row) || '—'}</td>
                  <td>
                    <span className={`eia-pill ${statusTone(status)}`} data-testid="security-status">
                      {status || '—'}
                    </span>
                  </td>
                  <td data-testid="security-action">
                    {actions.length > 0 ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        {actions.map((action) => (
                          <button
                            key={action.status}
                            type="button"
                            className={action.status === SECURITY_STATUS.EXPIRED
                              ? 'eia-btn-ghost'
                              : 'eia-btn-secondary'}
                            data-testid={`security-${action.label.toLowerCase()}`}
                            onClick={() => applyAction(row, action)}
                            disabled={!id || busy || Boolean(actionBusy)}
                          >
                            {actionBusy === id ? 'Saving…' : action.label}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <span className="eia-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr>
                <td className="eia-muted" colSpan={9} data-testid="security-loading">
                  Loading security…
                </td>
              </tr>
            )}
            {!loading && !loadError && rows.length === 0 && (
              <tr>
                <td className="eia-muted" colSpan={9} data-testid="security-empty">
                  No security records yet for this contract.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
