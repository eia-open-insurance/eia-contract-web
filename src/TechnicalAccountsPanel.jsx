import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import TechnicalAccountLines from './TechnicalAccountLines';
import {
  accountBalance,
  accountCededLosses,
  accountCededPremium,
  accountCommission,
  accountCurrency,
  accountId,
  accountNumber,
  accountStatus,
  balancePreview,
  buildCreatePayload,
  formatAmount,
  formatPeriod,
  nextAction,
  sortTechnicalAccounts,
  statusPayload,
  statusTone,
  summarizeTechnicalAccounts,
  technicalAccountStatusEndpoint,
  technicalAccountsEndpoint,
  validateCreateForm
} from './technicalAccounts';

function initialForm(currency) {
  return {
    periodFrom: '',
    periodTo: '',
    currency: currency || 'USD',
    cededPremiumAmount: '',
    cededLossAmount: '',
    commissionAmount: '',
    otherChargesAmount: ''
  };
}

function previewDirection(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) {
    return 'Nil balance.';
  }
  return amount > 0
    ? 'Balance due to the reinsurer.'
    : 'Balance due to the cedent.';
}

function confirmationFor(row, action) {
  const number = accountNumber(row) || 'this technical account';
  const period = formatPeriod(row);
  if (action.status === 'ISSUED') {
    return `Issue technical account ${number} for ${period}?\n\nIssuing makes the period statement available for settlement. The contract remains the source of its terms.`;
  }
  return `Settle technical account ${number} for ${period}?\n\nSettling records the period balance as settled. FS-RI and SAP own the posted amounts.`;
}

/**
 * Technical accounts tab: period statements for the selected contract.
 *
 * The contract provides the terms; a statement reports the ceded premium,
 * ceded losses, commission, and other charges for one period. Issuing and
 * settling are confirmed commands, and every failure stays inside this panel so
 * the contract record always remains usable.
 */
export default function TechnicalAccountsPanel({ contractId, currency = 'USD', onChanged }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(() => initialForm(currency));
  const [loading, setLoading] = useState(Boolean(contractId));
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [reconcileErrors, setReconcileErrors] = useState({});

  async function load() {
    if (!contractId) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(technicalAccountsEndpoint(contractId));
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setAccounts(rows);
      setLoadError('');
    } catch (error) {
      setAccounts([]);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(initialForm(currency));
    setMessage('');
    setActionError('');
    setExpandedId('');
    setReconcileErrors({});
    load();
  }, [contractId, currency]);

  function toggleLines(row) {
    const id = accountId(row);
    if (!id) return;
    setExpandedId((current) => (current === id ? '' : id));
  }

  function clearReconcileError(id) {
    setReconcileErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

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
      const created = await apiFetch(technicalAccountsEndpoint(contractId), {
        method: 'POST',
        body: JSON.stringify(buildCreatePayload(form))
      });
      setMessage(created?.accountNumber
        ? `Technical account ${created.accountNumber} recorded.`
        : 'Technical account recorded.');
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
    const id = accountId(row);
    setMessage('');
    setActionError('');
    clearReconcileError(id);
    setActionBusy(id);
    try {
      await apiFetch(technicalAccountStatusEndpoint(contractId, id), {
        method: 'PATCH',
        body: JSON.stringify(statusPayload(action.status))
      });
      setMessage(`Technical account ${accountNumber(row) || 'record'} ${action.verb}.`);
      await load();
      if (onChanged) {
        onChanged();
      }
    } catch (error) {
      if (error.status === 409 && error.code === 'ACCOUNT_LINES_DO_NOT_RECONCILE') {
        // The service rejected the issue because the statement lines do not
        // reconcile to the header. Keep the row on its server status (DRAFT) and
        // show the conflict in the expanded detail with the service's own
        // expected/actual explanation.
        setReconcileErrors((current) => ({
          ...current,
          [id]: {
            code: error.code,
            message: error.message,
            details: error.details || [],
            payload: error.payload || null
          }
        }));
        setExpandedId(id);
        await load();
        return;
      }
      setActionError(errorMessage(error));
      if (error.status === 409) {
        await load();
      }
    } finally {
      setActionBusy('');
    }
  }

  const sorted = useMemo(() => sortTechnicalAccounts(accounts), [accounts]);
  const summary = useMemo(() => summarizeTechnicalAccounts(accounts), [accounts]);
  const issuedCount = useMemo(
    () => accounts.filter((row) => accountStatus(row) === 'ISSUED').length,
    [accounts]
  );
  const preview = balancePreview(form);
  const hasAccounts = summary.count > 0;

  const summaryValue = (value) => {
    if (loading) return '…';
    if (loadError || !hasAccounts) return '—';
    return formatAmount(value, currency);
  };
  const outstandingValue = () => {
    if (loading) return '…';
    if (loadError || issuedCount === 0) return '—';
    return formatAmount(summary.outstandingBalance, currency);
  };
  const countValue = () => {
    if (loading) return '…';
    if (loadError) return '—';
    return String(summary.count);
  };
  const countLabel = loading
    ? '…'
    : loadError
      ? '—'
      : `${summary.count} account${summary.count === 1 ? '' : 's'}`;
  const displayedError = loadError
    ? `Technical accounts could not be loaded (${loadError}). The contract record is unaffected.`
    : actionError;

  if (!contractId) {
    return (
      <section aria-label="Technical accounts" data-testid="technical-accounts-panel">
        <div className="eia-section-title">
          <h2>Technical accounts</h2>
        </div>
        <div className="eia-empty">
          Select a contract from the register to work with its technical accounts.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Technical accounts" data-testid="technical-accounts-panel">
      <div className="eia-section-title">
        <h2>Technical accounts</h2>
        <span className="eia-muted" data-testid="technical-account-count">{countLabel}</span>
      </div>
      <p className="eia-muted">
        Period statements for this contract, newest period first. Issue a draft statement, then
        settle it once issued.
      </p>

      <div className="eia-summary-grid technical-account-summary">
        <div className="eia-card">
          <h3>Ceded premium</h3>
          <div className="value" data-testid="technical-account-summary-premium">
            {summaryValue(summary.cededPremium)}
          </div>
          <div className="eia-metric-label">across all statements</div>
        </div>
        <div className="eia-card">
          <h3>Ceded losses</h3>
          <div className="value" data-testid="technical-account-summary-losses">
            {summaryValue(summary.cededLosses)}
          </div>
          <div className="eia-metric-label">across all statements</div>
        </div>
        <div className="eia-card">
          <h3>Commission</h3>
          <div className="value" data-testid="technical-account-summary-commission">
            {summaryValue(summary.commission)}
          </div>
          <div className="eia-metric-label">ceding commission, all statements</div>
        </div>
        <div className="eia-card">
          <h3>Outstanding balance</h3>
          <div className="value" data-testid="technical-account-summary-outstanding">
            {outstandingValue()}
          </div>
          <div className="eia-metric-label">
            {issuedCount > 0
              ? `${issuedCount} issued statement${issuedCount === 1 ? '' : 's'} · positive is due to reinsurer`
              : 'issued statements only'}
          </div>
        </div>
        <div className="eia-card">
          <h3>Accounts</h3>
          <div className="value" data-testid="technical-account-summary-count">{countValue()}</div>
          <div className="eia-metric-label">period statements recorded</div>
        </div>
      </div>

      <div className="eia-context-panel" data-testid="technical-account-context-note">
        <h4>Statement, not the contract</h4>
        <p>
          A technical account is a period statement of ceded premium, ceded losses, commission, and
          other charges. The contract remains the source of its terms; FS-RI and SAP own the posted
          amounts. A DRAFT statement's lines must reconcile to its header within 0.01 before issue,
          and an issued statement's lines are immutable.
        </p>
      </div>

      <form
        className="eia-form-grid"
        onSubmit={submit}
        aria-label="Create technical account"
        style={{ margin: '16px 0' }}
      >
        <div className="eia-field">
          <label htmlFor="technical-account-period-from">Period start</label>
          <input
            id="technical-account-period-from"
            type="date"
            value={form.periodFrom}
            onChange={(event) => update('periodFrom', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-period-to">Period end</label>
          <input
            id="technical-account-period-to"
            type="date"
            value={form.periodTo}
            onChange={(event) => update('periodTo', event.target.value)}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-currency">Currency</label>
          <input
            id="technical-account-currency"
            maxLength={3}
            value={form.currency}
            onChange={(event) => update('currency', event.target.value.toUpperCase())}
            required
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-ceded-premium">Ceded premium</label>
          <input
            id="technical-account-ceded-premium"
            type="number"
            min="0"
            step="0.0001"
            placeholder="1000000.00"
            value={form.cededPremiumAmount}
            onChange={(event) => update('cededPremiumAmount', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-ceded-losses">Ceded losses</label>
          <input
            id="technical-account-ceded-losses"
            type="number"
            min="0"
            step="0.0001"
            placeholder="250000.00"
            value={form.cededLossAmount}
            onChange={(event) => update('cededLossAmount', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-commission">Commission</label>
          <input
            id="technical-account-commission"
            type="number"
            min="0"
            step="0.0001"
            placeholder="100000.00"
            value={form.commissionAmount}
            onChange={(event) => update('commissionAmount', event.target.value)}
          />
        </div>
        <div className="eia-field">
          <label htmlFor="technical-account-other-charges">Other charges</label>
          <input
            id="technical-account-other-charges"
            type="number"
            min="0"
            step="0.0001"
            placeholder="5000.00"
            value={form.otherChargesAmount}
            onChange={(event) => update('otherChargesAmount', event.target.value)}
          />
        </div>
        <div className="eia-field span-2" data-testid="technical-account-balance-preview">
          <span className="eia-metric-label">
            Balance preview · ceded premium − ceded losses − commission + other charges
          </span>
          <strong
            aria-live="polite"
            data-testid="technical-account-preview-amount"
            style={{ fontSize: 18, color: 'var(--eia-navy)' }}
          >
            {formatAmount(preview, form.currency)}
          </strong>
          <span className="eia-muted" data-testid="technical-account-preview-direction">
            {previewDirection(preview)}
          </span>
        </div>
        <div className="eia-field">
          <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record technical account'}</button>
        </div>
      </form>

      {displayedError && (
        <p role="alert" data-testid="technical-account-error">{displayedError}</p>
      )}
      {message && (
        <p role="status" data-testid="technical-account-message">{message}</p>
      )}

      <div className="eia-table-wrap">
        <table className="eia-table" aria-label="Technical accounts">
          <thead>
            <tr>
              <th aria-label="Statement lines" />
              <th>Account</th>
              <th>Period</th>
              <th>Ceded premium</th>
              <th>Ceded losses</th>
              <th>Commission</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const action = nextAction(row);
              const status = accountStatus(row);
              const rowCurrency = accountCurrency(row) || currency;
              const id = accountId(row);
              const expanded = Boolean(id) && expandedId === id;
              return (
                <Fragment key={id || accountNumber(row)}>
                  <tr data-testid="technical-account-row">
                    <td data-testid="technical-account-expand-cell">
                      <button
                        type="button"
                        className="eia-btn-ghost technical-account-expand"
                        aria-expanded={expanded}
                        aria-controls={`technical-account-lines-${id}`}
                        aria-label={`${expanded ? 'Hide' : 'Show'} lines for technical account ${accountNumber(row) || id}`}
                        data-testid="technical-account-expand"
                        onClick={() => toggleLines(row)}
                        disabled={!id}
                      >
                        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                        {' '}Lines
                      </button>
                    </td>
                    <td className="eia-mono" data-testid="technical-account-number">
                      {accountNumber(row) || '—'}
                    </td>
                    <td data-testid="technical-account-period">{formatPeriod(row)}</td>
                    <td data-testid="technical-account-ceded-premium">
                      {formatAmount(accountCededPremium(row), rowCurrency)}
                    </td>
                    <td data-testid="technical-account-ceded-losses">
                      {formatAmount(accountCededLosses(row), rowCurrency)}
                    </td>
                    <td data-testid="technical-account-commission">
                      {formatAmount(accountCommission(row), rowCurrency)}
                    </td>
                    <td data-testid="technical-account-balance">
                      {formatAmount(accountBalance(row), rowCurrency)}
                    </td>
                    <td>
                      <span className={`eia-pill ${statusTone(status)}`} data-testid="technical-account-status">
                        {status || '—'}
                      </span>
                    </td>
                    <td data-testid="technical-account-action">
                      {action ? (
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          onClick={() => applyAction(row, action)}
                          disabled={!id || busy || Boolean(actionBusy)}
                        >
                          {actionBusy === id ? 'Saving…' : action.label}
                        </button>
                      ) : (
                        <span className="eia-muted">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr
                      className="eia-technical-account-expanded"
                      data-testid="technical-account-lines-row"
                    >
                      <td colSpan={9} id={`technical-account-lines-${id}`}>
                        <TechnicalAccountLines
                          contractId={contractId}
                          account={row}
                          currency={rowCurrency}
                          reconcileError={reconcileErrors[id] || null}
                          onLinesChanged={clearReconcileError}
                          onAccountChanged={load}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {loading && (
              <tr>
                <td className="eia-muted" colSpan={9} data-testid="technical-account-loading">
                  Loading technical accounts…
                </td>
              </tr>
            )}
            {!loading && !loadError && sorted.length === 0 && (
              <tr>
                <td className="eia-muted" colSpan={9} data-testid="technical-account-empty">
                  No technical accounts yet for this contract.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
