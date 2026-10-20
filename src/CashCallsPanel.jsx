import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import {
  CASH_CALL_STATUS,
  buildCreatePayload,
  cashCallActions,
  cashCallAmount,
  cashCallCurrency,
  cashCallDueDate,
  cashCallNotes,
  cashCallNumber,
  cashCallRowId,
  cashCallStatus,
  cashCallStatusEndpoint,
  cashCallsEndpoint,
  formatAmount,
  formatDate,
  formatPeriod,
  sortCashCalls,
  statusPayload,
  statusTone,
  summarizeCashCalls,
  validateCreateForm
} from './cashCalls';

function initialForm(currency) {
  return {
    periodStart: '',
    periodEnd: '',
    amount: '',
    currency: currency || 'USD',
    dueDate: '',
    notes: ''
  };
}

function confirmationFor(row, action) {
  const number = cashCallNumber(row) || 'this cash call';
  const period = formatPeriod(row);
  if (action.status === CASH_CALL_STATUS.ISSUED) {
    return `Issue cash call ${number} for ${period}?\n\nIssuing sends the funding request to the cedent or reinsurer. It is not a Payment; Payment and FS-RI own execution.`;
  }
  if (action.status === CASH_CALL_STATUS.CANCELLED) {
    return `Cancel cash call ${number} for ${period}?\n\nCancelling withdraws the funding request before it is issued. It is not a Payment; Payment and FS-RI own execution.`;
  }
  return `Settle cash call ${number} for ${period}?\n\nSettling records the issued funding request as settled. It is not a Payment; Payment and FS-RI own execution.`;
}

/**
 * Cash calls tab: the selected contract's interim funding requests.
 *
 * A cash call is a request for funding, not a Payment. The request is created
 * REQUESTED, can be issued or cancelled, and an issued request can be settled.
 * Every failure stays inside this panel so the contract record always remains
 * usable.
 */
export default function CashCallsPanel({ contractId, currency = 'USD', onChanged }) {
  const [cashCalls, setCashCalls] = useState([]);
  const [form, setForm] = useState(() => initialForm(currency));
  const [loading, setLoading] = useState(Boolean(contractId));
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!contractId) {
      setCashCalls([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(cashCallsEndpoint(contractId));
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setCashCalls(rows);
      setLoadError('');
    } catch (error) {
      setCashCalls([]);
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
      const created = await apiFetch(cashCallsEndpoint(contractId), {
        method: 'POST',
        body: JSON.stringify(buildCreatePayload(form))
      });
      setMessage(created?.callNumber
        ? `Cash call ${created.callNumber} requested.`
        : 'Cash call requested.');
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
    if (!window.confirm(confirmationFor(row, action))) {
      return;
    }
    const id = cashCallRowId(row);
    setMessage('');
    setActionError('');
    setActionBusy(id);
    try {
      await apiFetch(cashCallStatusEndpoint(contractId, id), {
        method: 'PATCH',
        body: JSON.stringify(statusPayload(action.status))
      });
      setMessage(`Cash call ${cashCallNumber(row) || 'record'} ${action.verb}.`);
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

  const sorted = useMemo(() => sortCashCalls(cashCalls), [cashCalls]);
  const summary = useMemo(() => summarizeCashCalls(cashCalls), [cashCalls]);

  const countValue = (value) => {
    if (loading) return '…';
    if (loadError) return '—';
    return String(value);
  };
  const amountValue = (value, count) => {
    if (loading) return '…';
    if (loadError || count === 0) return '—';
    return formatAmount(value, currency);
  };
  const countLabel = loading
    ? '…'
    : loadError
      ? '—'
      : `${summary.count} cash call${summary.count === 1 ? '' : 's'}`;
  const displayedError = loadError
    ? `Cash calls could not be loaded (${loadError}). The contract record is unaffected.`
    : actionError;

  if (!contractId) {
    return (
      <section aria-label="Cash calls" data-testid="cash-calls-panel">
        <div className="eia-section-title">
          <h2>Cash calls</h2>
        </div>
        <div className="eia-empty">
          Select a contract from the register to work with its cash calls.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Cash calls" data-testid="cash-calls-panel">
      <div className="eia-section-title">
        <h2>Cash calls</h2>
        <span className="eia-muted" data-testid="cash-call-count">{countLabel}</span>
      </div>
      <p className="eia-muted">
        Interim funding requests for this contract, newest period first. Issue a
        request, settle it once issued, or cancel it while it is still a request.
      </p>

      <div className="eia-summary-grid cash-call-summary">
        <div className="eia-card">
          <h3>Requested</h3>
          <div className="value" data-testid="cash-call-summary-requested">
            {countValue(summary.requestedCount)}
          </div>
          <div className="eia-metric-label">awaiting issue or cancellation</div>
        </div>
        <div className="eia-card">
          <h3>Issued</h3>
          <div className="value" data-testid="cash-call-summary-issued">
            {countValue(summary.issuedCount)}
          </div>
          <div className="eia-metric-label">issued and awaiting settlement</div>
        </div>
        <div className="eia-card">
          <h3>Issued amount</h3>
          <div className="value" data-testid="cash-call-summary-issued-amount">
            {amountValue(summary.issuedAmount, summary.issuedCount)}
          </div>
          <div className="eia-metric-label">outstanding funding requests</div>
        </div>
        <div className="eia-card">
          <h3>Settled amount</h3>
          <div className="value" data-testid="cash-call-summary-settled-amount">
            {amountValue(summary.settledAmount, summary.settledCount)}
          </div>
          <div className="eia-metric-label">funding requests settled</div>
        </div>
        <div className="eia-card">
          <h3>Overdue due dates</h3>
          <div className="value" data-testid="cash-call-summary-overdue">
            {countValue(summary.overdueCount)}
          </div>
          <div className="eia-metric-label">open calls past their due date</div>
        </div>
      </div>

      <div className="eia-context-panel" data-testid="cash-call-context-note">
        <h4>Funding request, not a Payment</h4>
        <p>
          A cash call requests funding from the cedent or reinsurer for a contract
          period. It is not a Payment: Payment and FS-RI own execution. Issuing,
          settling, or cancelling a cash call never changes the contract record.
        </p>
      </div>

      <form
        className="eia-form-grid"
        onSubmit={submit}
        aria-label="Create cash call"
        style={{ margin: '16px 0' }}
      >
        <div className="eia-field">
          <label htmlFor="cash-call-period-start">Period start</label>
          <input
            id="cash-call-period-start"
            type="date"
            value={form.periodStart}
            onChange={(event) => update('periodStart', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cash-call-period-end">Period end</label>
          <input
            id="cash-call-period-end"
            type="date"
            value={form.periodEnd}
            onChange={(event) => update('periodEnd', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cash-call-amount">Amount</label>
          <input
            id="cash-call-amount"
            type="number"
            min="0"
            step="0.0001"
            placeholder="1500000.00"
            value={form.amount}
            onChange={(event) => update('amount', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cash-call-currency">Currency</label>
          <input
            id="cash-call-currency"
            maxLength={3}
            value={form.currency}
            onChange={(event) => update('currency', event.target.value.toUpperCase())}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="cash-call-due-date">Due date</label>
          <input
            id="cash-call-due-date"
            type="date"
            value={form.dueDate}
            onChange={(event) => update('dueDate', event.target.value)}
            required
          />
        </div>
        <div className="eia-field span-2">
          <label htmlFor="cash-call-notes">Notes</label>
          <textarea
            id="cash-call-notes"
            maxLength={4000}
            rows={2}
            placeholder="Funding reason, call basis, or reference"
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Request cash call'}</button>
        </div>
      </form>

      {displayedError && (
        <p role="alert" data-testid="cash-call-error">{displayedError}</p>
      )}
      {message && (
        <p role="status" data-testid="cash-call-message">{message}</p>
      )}

      <div className="eia-table-wrap">
        <table className="eia-table" aria-label="Cash calls">
          <thead>
            <tr>
              <th>Call number</th>
              <th>Period</th>
              <th>Amount / currency</th>
              <th>Due date</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const id = cashCallRowId(row);
              const status = cashCallStatus(row);
              const rowCurrency = cashCallCurrency(row) || currency;
              const actions = cashCallActions(row);
              return (
                <tr key={id || cashCallNumber(row)} data-testid="cash-call-row">
                  <td className="eia-mono" data-testid="cash-call-number">
                    {cashCallNumber(row) || '—'}
                  </td>
                  <td data-testid="cash-call-period">{formatPeriod(row)}</td>
                  <td data-testid="cash-call-amount">
                    {formatAmount(cashCallAmount(row), rowCurrency)}
                    <span className="eia-muted" data-testid="cash-call-currency">
                      {' '}{rowCurrency}
                    </span>
                  </td>
                  <td data-testid="cash-call-due-date">{formatDate(cashCallDueDate(row))}</td>
                  <td>
                    <span className={`eia-pill ${statusTone(status)}`} data-testid="cash-call-status">
                      {status || '—'}
                    </span>
                  </td>
                  <td data-testid="cash-call-notes">{cashCallNotes(row) || '—'}</td>
                  <td data-testid="cash-call-action">
                    {actions.length > 0 ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        {actions.map((action) => (
                          <button
                            key={action.status}
                            type="button"
                            className={action.status === CASH_CALL_STATUS.CANCELLED
                              ? 'eia-btn-ghost'
                              : 'eia-btn-secondary'}
                            data-testid={`cash-call-${action.label.toLowerCase()}`}
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
                <td className="eia-muted" colSpan={7} data-testid="cash-call-loading">
                  Loading cash calls…
                </td>
              </tr>
            )}
            {!loading && !loadError && sorted.length === 0 && (
              <tr>
                <td className="eia-muted" colSpan={7} data-testid="cash-call-empty">
                  No cash calls yet for this contract.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
