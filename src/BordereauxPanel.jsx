import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import { technicalAccountsEndpoint } from './technicalAccounts';
import {
  BORDEREAU_STATUS,
  bordereauCommission,
  bordereauCurrency,
  bordereauLineCount,
  bordereauLoss,
  bordereauNumber,
  bordereauPremium,
  bordereauReceivedDate,
  bordereauRowId,
  bordereauStatus,
  bordereauStatusEndpoint,
  bordereauxEndpoint,
  buildCreatePayload,
  failPayload,
  formatAmount,
  formatPeriod,
  isActionable,
  linkedTechnicalAccount,
  processPayload,
  sortBordereaux,
  statusTone,
  summarizeBordereaux,
  validateCreateForm
} from './bordereaux';

function initialForm(currency) {
  return {
    periodFrom: '',
    periodTo: '',
    receivedDate: '',
    currency: currency || 'USD',
    premium: '',
    loss: '',
    commission: '',
    otherCharges: '',
    lineCount: '',
    notes: ''
  };
}

function confirmationFor(row) {
  const number = bordereauNumber(row) || 'this bordereau';
  const period = formatPeriod(row);
  return `Process bordereau ${number} for ${period}?\n\nProcessing creates a technical account from the cedent's submission and records the period amounts. The contract remains the source of its terms.`;
}

function shortId(value) {
  return value ? String(value).slice(0, 8) : '';
}

/**
 * Bordereaux tab: the cedent's period submissions for the selected contract.
 *
 * A bordereau is a submission, not the contract. A RECEIVED submission can be
 * processed into a technical account or failed with an optional note; both
 * outcomes are terminal here. Every failure stays inside this panel so the
 * contract record always remains usable.
 */
export default function BordereauxPanel({
  contractId,
  currency = 'USD',
  onChanged,
  onOpenTechnicalAccounts
}) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(() => initialForm(currency));
  const [loading, setLoading] = useState(Boolean(contractId));
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [failTarget, setFailTarget] = useState(null);
  const [failNote, setFailNote] = useState('');
  const [processedAccount, setProcessedAccount] = useState(null);
  const [accountLabels, setAccountLabels] = useState({});

  /**
   * The bordereau stores the technical account by id; the account number lives
   * on the account itself. Resolving the numbers is an enhancement, so a failed
   * lookup leaves the id on screen and never breaks the bordereau tab.
   */
  async function labelsFor(nextRows) {
    const ids = new Set(
      nextRows.map((row) => linkedTechnicalAccount(row)?.id).filter(Boolean)
    );
    if (ids.size === 0) {
      setAccountLabels({});
      return {};
    }
    try {
      const payload = await apiFetch(technicalAccountsEndpoint(contractId));
      const accounts = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.items) ? payload.items : []);
      const labels = {};
      for (const account of accounts) {
        const id = String(account.id ?? account.accountId ?? '');
        const number = account.accountNumber ?? account.technicalAccountNumber ?? '';
        if (id && number) {
          labels[id] = String(number);
        }
      }
      setAccountLabels(labels);
      return labels;
    } catch {
      setAccountLabels({});
      return {};
    }
  }

  async function load() {
    if (!contractId) {
      setRows([]);
      setLoading(false);
      return { rows: [], labels: {} };
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(bordereauxEndpoint(contractId));
      const nextRows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setRows(nextRows);
      setLoadError('');
      const labels = await labelsFor(nextRows);
      return { rows: nextRows, labels };
    } catch (error) {
      setRows([]);
      setAccountLabels({});
      setLoadError(errorMessage(error));
      return { rows: [], labels: {} };
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(initialForm(currency));
    setMessage('');
    setActionError('');
    setFailTarget(null);
    setFailNote('');
    setProcessedAccount(null);
    load();
  }, [contractId, currency]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setActionError('');
    setProcessedAccount(null);
    const issues = validateCreateForm(form);
    if (issues.length > 0) {
      setActionError(issues.join(' '));
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch(bordereauxEndpoint(contractId), {
        method: 'POST',
        body: JSON.stringify(buildCreatePayload(form))
      });
      setMessage(created?.bordereauNumber
        ? `Bordereau ${created.bordereauNumber} recorded.`
        : 'Bordereau recorded.');
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

  async function process(row) {
    if (!window.confirm(confirmationFor(row))) {
      return;
    }
    const id = bordereauRowId(row);
    setMessage('');
    setActionError('');
    setProcessedAccount(null);
    setActionBusy(id);
    try {
      const updated = await apiFetch(bordereauStatusEndpoint(contractId, id), {
        method: 'PATCH',
        body: JSON.stringify(processPayload())
      });
      const { rows: refreshed, labels } = await load();
      const fresh = refreshed.find((candidate) => bordereauRowId(candidate) === id);
      const account = linkedTechnicalAccount(updated) || linkedTechnicalAccount(fresh);
      const label = account ? (account.number || labels[account.id] || shortId(account.id)) : '';
      setProcessedAccount(account ? { ...account, label } : null);
      setMessage(label
        ? `Bordereau ${bordereauNumber(row) || 'record'} processed. Technical account ${label} created.`
        : `Bordereau ${bordereauNumber(row) || 'record'} processed. A technical account was created for the period.`);
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

  function openFail(row) {
    setMessage('');
    setActionError('');
    setProcessedAccount(null);
    setFailTarget(row);
    setFailNote('');
  }

  function cancelFail() {
    setFailTarget(null);
    setFailNote('');
  }

  async function confirmFail() {
    if (!failTarget) {
      return;
    }
    const row = failTarget;
    const id = bordereauRowId(row);
    setActionBusy(id);
    setActionError('');
    try {
      await apiFetch(bordereauStatusEndpoint(contractId, id), {
        method: 'PATCH',
        body: JSON.stringify(failPayload(failNote))
      });
      setFailTarget(null);
      setFailNote('');
      await load();
      setMessage(`Bordereau ${bordereauNumber(row) || 'record'} failed.`);
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

  const sorted = useMemo(() => sortBordereaux(rows), [rows]);
  const summary = useMemo(() => summarizeBordereaux(rows), [rows]);
  const hasRows = summary.count > 0;

  const summaryAmount = (value) => {
    if (loading) return '…';
    if (loadError || !hasRows) return '—';
    return formatAmount(value, currency);
  };
  const summaryCount = (value) => {
    if (loading) return '…';
    if (loadError) return '—';
    return String(value);
  };
  const summaryLineCount = () => {
    if (loading) return '…';
    if (loadError || !hasRows) return '—';
    return String(summary.lineCount);
  };
  const countLabel = loading
    ? '…'
    : loadError
      ? '—'
      : `${summary.count} bordereau${summary.count === 1 ? '' : 'x'}`;
  const displayedError = loadError
    ? `Bordereaux could not be loaded (${loadError}). The contract record is unaffected.`
    : actionError;

  if (!contractId) {
    return (
      <section aria-label="Bordereaux" data-testid="bordereaux-panel">
        <div className="eia-section-title">
          <h2>Bordereaux</h2>
        </div>
        <div className="eia-empty">
          Select a contract from the register to work with its bordereaux.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Bordereaux" data-testid="bordereaux-panel">
      <div className="eia-section-title">
        <h2>Bordereaux</h2>
        <span className="eia-muted" data-testid="bordereau-count">{countLabel}</span>
      </div>
      <p className="eia-muted">
        Period submissions from the cedent, newest period first. Process a received
        submission to create its technical account, or fail it with an optional note.
      </p>

      <div className="eia-summary-grid bordereau-summary">
        <div className="eia-card">
          <h3>Received</h3>
          <div className="value" data-testid="bordereau-summary-received">
            {summaryCount(summary.receivedCount)}
          </div>
          <div className="eia-metric-label">awaiting processing</div>
        </div>
        <div className="eia-card">
          <h3>Processed</h3>
          <div className="value" data-testid="bordereau-summary-processed">
            {summaryCount(summary.processedCount)}
          </div>
          <div className="eia-metric-label">technical accounts created</div>
        </div>
        <div className="eia-card">
          <h3>Premium</h3>
          <div className="value" data-testid="bordereau-summary-premium">
            {summaryAmount(summary.premium)}
          </div>
          <div className="eia-metric-label">across all submissions</div>
        </div>
        <div className="eia-card">
          <h3>Loss</h3>
          <div className="value" data-testid="bordereau-summary-loss">
            {summaryAmount(summary.loss)}
          </div>
          <div className="eia-metric-label">across all submissions</div>
        </div>
        <div className="eia-card">
          <h3>Lines</h3>
          <div className="value" data-testid="bordereau-summary-line-count">
            {summaryLineCount()}
          </div>
          <div className="eia-metric-label">submitted lines in total</div>
        </div>
      </div>

      <div className="eia-context-panel" data-testid="bordereau-context-note">
        <h4>Submission, not the contract</h4>
        <p>
          A bordereau is the cedent's period submission of premium, loss,
          commission, and other charges. Processing it creates the period's
          technical account; the contract remains the source of its terms. FS-RI
          and SAP own the posted amounts.
        </p>
      </div>

      <form
        className="eia-form-grid"
        onSubmit={submit}
        aria-label="Create bordereau"
        style={{ margin: '16px 0' }}
      >
        <div className="eia-field">
          <label htmlFor="bordereau-period-from">Period start</label>
          <input
            id="bordereau-period-from"
            type="date"
            value={form.periodFrom}
            onChange={(event) => update('periodFrom', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-period-to">Period end</label>
          <input
            id="bordereau-period-to"
            type="date"
            value={form.periodTo}
            onChange={(event) => update('periodTo', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-received-date">Received date</label>
          <input
            id="bordereau-received-date"
            type="date"
            value={form.receivedDate}
            onChange={(event) => update('receivedDate', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-currency">Currency</label>
          <input
            id="bordereau-currency"
            maxLength={3}
            value={form.currency}
            onChange={(event) => update('currency', event.target.value.toUpperCase())}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-premium">Premium</label>
          <input
            id="bordereau-premium"
            type="number"
            min="0"
            step="0.0001"
            placeholder="1000000.00"
            value={form.premium}
            onChange={(event) => update('premium', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-loss">Loss</label>
          <input
            id="bordereau-loss"
            type="number"
            min="0"
            step="0.0001"
            placeholder="250000.00"
            value={form.loss}
            onChange={(event) => update('loss', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-commission">Commission</label>
          <input
            id="bordereau-commission"
            type="number"
            min="0"
            step="0.0001"
            placeholder="100000.00"
            value={form.commission}
            onChange={(event) => update('commission', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-other-charges">Other charges</label>
          <input
            id="bordereau-other-charges"
            type="number"
            min="0"
            step="0.0001"
            placeholder="5000.00"
            value={form.otherCharges}
            onChange={(event) => update('otherCharges', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="bordereau-line-count">Line count</label>
          <input
            id="bordereau-line-count"
            type="number"
            min="0"
            step="1"
            placeholder="12"
            value={form.lineCount}
            onChange={(event) => update('lineCount', event.target.value)}
          />
        </div>
        <div className="eia-field span-2">
          <label htmlFor="bordereau-notes">Notes</label>
          <textarea
            id="bordereau-notes"
            maxLength={400}
            rows={2}
            placeholder="Cedent file reference or submission note"
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record bordereau'}</button>
        </div>
      </form>

      {displayedError && (
        <p role="alert" data-testid="bordereau-error">{displayedError}</p>
      )}
      {message && (
        <div role="status" data-testid="bordereau-message">
          <span>{message}</span>
          {processedAccount && processedAccount.label && onOpenTechnicalAccounts && (
            <>
              {' '}
              <button
                type="button"
                className="eia-btn-ghost"
                data-testid="bordereau-message-account-link"
                onClick={onOpenTechnicalAccounts}
              >
                Open technical account {processedAccount.label}
              </button>
            </>
          )}
        </div>
      )}

      {failTarget && (
        <section
          className="eia-card"
          aria-label="Fail bordereau"
          data-testid="bordereau-fail-form"
          style={{ marginBottom: 14 }}
        >
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h3>Fail bordereau {bordereauNumber(failTarget) || 'record'}</h3>
            <span className="eia-muted">{formatPeriod(failTarget)}</span>
          </div>
          <div className="eia-field">
            <label htmlFor="bordereau-fail-note">Failure note (optional)</label>
            <textarea
              id="bordereau-fail-note"
              maxLength={400}
              rows={2}
              placeholder="Why the submission cannot be processed"
              value={failNote}
              onChange={(event) => setFailNote(event.target.value)}
            />
          </div>
          <div className="eia-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={confirmFail}
              disabled={Boolean(actionBusy)}
            >
              {actionBusy === bordereauRowId(failTarget) ? 'Saving…' : 'Confirm fail'}
            </button>
            <button type="button" className="eia-btn-ghost" onClick={cancelFail}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="eia-table-wrap">
        <table className="eia-table" aria-label="Bordereaux">
          <thead>
            <tr>
              <th>Bordereau</th>
              <th>Period</th>
              <th>Received</th>
              <th>Lines</th>
              <th>Premium</th>
              <th>Loss</th>
              <th>Commission</th>
              <th>Status</th>
              <th>Technical account</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const id = bordereauRowId(row);
              const status = bordereauStatus(row);
              const rowCurrency = bordereauCurrency(row) || currency;
              const account = linkedTechnicalAccount(row);
              const accountLabel = account
                ? (account.number || accountLabels[account.id] || shortId(account.id))
                : '';
              const actionable = isActionable(row);
              return (
                <tr key={id || bordereauNumber(row)} data-testid="bordereau-row">
                  <td className="eia-mono" data-testid="bordereau-number">
                    {bordereauNumber(row) || '—'}
                  </td>
                  <td data-testid="bordereau-period">{formatPeriod(row)}</td>
                  <td data-testid="bordereau-received">{bordereauReceivedDate(row) || '—'}</td>
                  <td data-testid="bordereau-line-count">{bordereauLineCount(row)}</td>
                  <td data-testid="bordereau-premium">
                    {formatAmount(bordereauPremium(row), rowCurrency)}
                  </td>
                  <td data-testid="bordereau-loss">
                    {formatAmount(bordereauLoss(row), rowCurrency)}
                  </td>
                  <td data-testid="bordereau-commission">
                    {formatAmount(bordereauCommission(row), rowCurrency)}
                  </td>
                  <td>
                    <span className={`eia-pill ${statusTone(status)}`} data-testid="bordereau-status">
                      {status || '—'}
                    </span>
                  </td>
                  <td data-testid="bordereau-technical-account">
                    {accountLabel ? (
                      onOpenTechnicalAccounts ? (
                        <button
                          type="button"
                          className="eia-btn-ghost"
                          data-testid="bordereau-account-link"
                          onClick={onOpenTechnicalAccounts}
                          title={`Technical account ${account.id || accountLabel}`}
                        >
                          {accountLabel}
                        </button>
                      ) : (
                        <span>{accountLabel}</span>
                      )
                    ) : (
                      <span className="eia-muted">
                        {status === BORDEREAU_STATUS.RECEIVED ? 'Not yet processed' : '—'}
                      </span>
                    )}
                  </td>
                  <td data-testid="bordereau-action">
                    {actionable ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          data-testid="bordereau-process"
                          onClick={() => process(row)}
                          disabled={busy || Boolean(actionBusy)}
                        >
                          {actionBusy === id ? 'Saving…' : 'Process'}
                        </button>
                        <button
                          type="button"
                          className="eia-btn-ghost"
                          data-testid="bordereau-fail"
                          onClick={() => openFail(row)}
                          disabled={busy || Boolean(actionBusy)}
                        >
                          Fail
                        </button>
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
                <td className="eia-muted" colSpan={10} data-testid="bordereau-loading">
                  Loading bordereaux…
                </td>
              </tr>
            )}
            {!loading && !loadError && sorted.length === 0 && (
              <tr>
                <td className="eia-muted" colSpan={10} data-testid="bordereau-empty">
                  No bordereaux yet for this contract.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
