import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import {
  accountCurrency,
  accountId as accountRecordId,
  accountNumber,
  accountStatus,
  buildLinePayload,
  formatAmount,
  initialLineForm,
  lineAmount,
  lineDescription,
  lineId,
  lineReference,
  lineRows,
  lineType,
  lineTypeLabel,
  reconcileAccountLines,
  reconcileErrorRows,
  technicalAccountLineEndpoint,
  technicalAccountLinesEndpoint,
  validateLineForm,
  TECHNICAL_ACCOUNT_LINE_TYPES
} from './technicalAccounts';

function reconciliationTone(status) {
  if (status === 'reconciled') return 'green';
  if (status === 'unreconciled') return 'red';
  return 'amber';
}

function reconciliationLabel(status) {
  if (status === 'reconciled') return 'Reconciled';
  if (status === 'unreconciled') return 'Not reconciled';
  return 'No lines';
}

function reconciliationNote(status, tolerance) {
  if (status === 'reconciled') {
    return `Lines match every header component within ${tolerance.toFixed(2)}.`;
  }
  if (status === 'unreconciled') {
    return `Lines differ from the header by more than ${tolerance.toFixed(2)}. Add or remove lines, or correct the header, before issuing.`;
  }
  return 'No lines are recorded. A header-only statement has no line detail to reconcile and remains issuable; add lines to itemise it.';
}

function componentLabel(component) {
  switch (component) {
    case 'premium':
      return 'Ceded premium';
    case 'losses':
      return 'Ceded losses';
    case 'commission':
      return 'Commission';
    case 'otherCharges':
      return 'Other charges';
    default:
      return component;
  }
}

function lineDisplayName(row) {
  const reference = lineReference(row);
  if (reference) return reference;
  const type = lineType(row);
  return type ? lineTypeLabel(type) : 'line';
}

/**
 * Expandable statement detail for one technical account.
 *
 * A DRAFT statement owns an editable set of lines and must reconcile to its
 * header before it can be issued. Once issued (or settled) the statement is
 * immutable, so this panel hides both the add form and the delete action. The
 * service remains authoritative on every write and on the issue reconciliation
 * check; this panel only mirrors the arithmetic so the difference is visible.
 */
export default function TechnicalAccountLines({
  contractId,
  account,
  currency = 'USD',
  reconcileError = null,
  onLinesChanged,
  onAccountChanged
}) {
  const id = accountRecordId(account);
  const status = accountStatus(account);
  const editable = status === 'DRAFT';
  const rowCurrency = accountCurrency(account) || currency;
  const number = accountNumber(account);

  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(initialLineForm);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState('');

  async function load() {
    if (!id) {
      setLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const payload = await apiFetch(technicalAccountLinesEndpoint(contractId, id));
      setLines(lineRows(payload));
    } catch (error) {
      setLines([]);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(initialLineForm());
    setFormError('');
    setActionError('');
    setMessage('');
    load();
  }, [contractId, id]);

  const reconciliation = useMemo(
    () => reconcileAccountLines(account, lines),
    [account, lines]
  );
  const byType = reconciliation.byType;
  const serviceConflictRows = useMemo(() => reconcileErrorRows(reconcileError), [reconcileError]);
  // The public domain API may forward only the conflict code and message and drop
  // the expert's per-type field violations. In that case the locally computed
  // differences are the detail the user needs, so show them instead of an empty
  // explanation.
  const localConflictRows = useMemo(
    () => reconciliation.components
      .filter((row) => !row.withinTolerance)
      .map((row) => ({
        label: row.label,
        value: `header ${formatAmount(row.header, rowCurrency)} vs lines `
          + `${formatAmount(row.lines, rowCurrency)} `
          + `(difference ${formatAmount(row.difference, rowCurrency)})`
      })),
    [reconciliation, rowCurrency]
  );
  const conflictRows = serviceConflictRows.length > 0 ? serviceConflictRows : localConflictRows;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setFormError('');
    setActionError('');
    setMessage('');
    const issues = validateLineForm(form);
    if (issues.length > 0) {
      setFormError(issues.join(' '));
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch(technicalAccountLinesEndpoint(contractId, id), {
        method: 'POST',
        body: JSON.stringify(buildLinePayload(form))
      });
      const createdType = lineType(created) || form.lineType;
      setMessage(`${lineTypeLabel(createdType)} line recorded.`);
      setForm(initialLineForm());
      await load();
      if (onLinesChanged) {
        onLinesChanged(id);
      }
    } catch (error) {
      setFormError(errorMessage(error));
      if (error.status === 409 && onAccountChanged) {
        // The account stopped being DRAFT (another user issued it); reload the
        // header so the panel flips to its immutable view.
        onAccountChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(row) {
    const lineKey = lineId(row);
    if (!lineKey) {
      return;
    }
    const confirmed = window.confirm(
      `Delete the ${lineTypeLabel(lineType(row))} line ${lineDisplayName(row)}?\n\n`
      + 'The line is removed from this DRAFT statement. Issued statements are immutable.'
    );
    if (!confirmed) {
      return;
    }
    setActionError('');
    setMessage('');
    setDeleteBusy(lineKey);
    try {
      await apiFetch(technicalAccountLineEndpoint(contractId, id, lineKey), {
        method: 'DELETE'
      });
      setMessage(`${lineTypeLabel(lineType(row))} line deleted.`);
      await load();
      if (onLinesChanged) {
        onLinesChanged(id);
      }
    } catch (error) {
      setActionError(errorMessage(error));
      if (error.status === 409 && onAccountChanged) {
        onAccountChanged();
      }
    } finally {
      setDeleteBusy('');
    }
  }

  const tone = reconciliationTone(reconciliation.status);

  return (
    <section
      className="eia-card technical-account-lines"
      aria-label={`Statement lines for technical account ${number || id}`}
      data-testid="technical-account-lines-panel"
    >
      <div className="eia-section-title" style={{ marginTop: 0 }}>
        <h3>Statement lines</h3>
        <span className="eia-muted" data-testid="technical-account-line-count">
          {loading ? '…' : `${lines.length} line${lines.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <p className="eia-muted" style={{ marginTop: 0 }}>
        Lines itemise the period statement by type. The header must reconcile to these
        lines before a DRAFT can be issued; an ISSUED or SETTLED statement is immutable.
      </p>

      {reconcileError && (
        <div
          className="eia-reconcile-conflict"
          role="alert"
          data-testid="technical-account-lines-reconcile-error"
        >
          <strong>
            {reconcileError.code ? `${reconcileError.code}: ` : ''}
            {reconcileError.message}
          </strong>
          {conflictRows.length > 0 && (
            <ul data-testid="technical-account-lines-reconcile-details">
              {conflictRows.map((detail, index) => (
                <li key={`${detail.label}-${index}`}>
                  <span className="eia-reconcile-label">{detail.label}</span>
                  {' '}
                  {detail.value}
                </li>
              ))}
            </ul>
          )}
          <p>
            The statement remains DRAFT. Correct the lines or the header, then issue it
            again.
          </p>
        </div>
      )}

      {loading && (
        <p className="eia-muted" data-testid="technical-account-lines-loading">
          Loading statement lines…
        </p>
      )}

      {!loading && loadError && (
        <p role="alert" data-testid="technical-account-lines-error">
          Statement lines could not be loaded ({loadError}). The technical account and
          the rest of the contract record are unaffected.
        </p>
      )}

      {!loading && !loadError && (
        <>
          {lines.length === 0 ? (
            <div className="eia-empty" data-testid="technical-account-lines-empty">
              No statement lines recorded yet.
            </div>
          ) : (
            <div className="eia-table-wrap" style={{ marginBottom: 14 }}>
              <table className="eia-table" aria-label="Statement lines">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, index) => {
                    const key = lineId(row) || `line-${index}`;
                    const type = lineType(row);
                    return (
                      <tr key={key} data-testid="technical-account-line-row">
                        <td data-testid="technical-account-line-type">{lineTypeLabel(type) || '—'}</td>
                        <td className="eia-mono" data-testid="technical-account-line-reference">
                          {lineReference(row) || '—'}
                        </td>
                        <td data-testid="technical-account-line-description">
                          {lineDescription(row) || '—'}
                        </td>
                        <td data-testid="technical-account-line-amount">
                          {formatAmount(lineAmount(row), rowCurrency)}
                        </td>
                        <td data-testid="technical-account-line-action">
                          {editable ? (
                            <button
                              type="button"
                              className="eia-btn-ghost"
                              onClick={() => removeLine(row)}
                              disabled={busy || Boolean(deleteBusy)}
                            >
                              {deleteBusy === lineId(row) ? 'Deleting…' : 'Delete'}
                            </button>
                          ) : (
                            <span className="eia-muted">Locked</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="eia-section-title">
            <h4 className="eia-subheading">Totals by type</h4>
            <span className="eia-muted" data-testid="technical-account-line-type-count">
              {byType.length} type{byType.length === 1 ? '' : 's'}
            </span>
          </div>
          {byType.length === 0 ? (
            <p className="eia-muted" data-testid="technical-account-line-totals-empty">
              No line totals to group yet.
            </p>
          ) : (
            <div className="eia-table-wrap" style={{ marginBottom: 14 }}>
              <table className="eia-table" aria-label="Line totals by type">
                <thead>
                  <tr>
                    <th>Line type</th>
                    <th>Lines</th>
                    <th>Header component</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr key={row.type} data-testid={`technical-account-line-total-${row.type}`}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>{componentLabel(row.component)}</td>
                      <td>{formatAmount(row.amount, rowCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="eia-section-title">
            <h4 className="eia-subheading">Reconciliation</h4>
            <span
              className={`eia-pill ${tone}`}
              data-testid="technical-account-lines-reconciled"
              data-status={reconciliation.status}
            >
              {reconciliationLabel(reconciliation.status)}
            </span>
          </div>
          <p className="eia-muted" data-testid="technical-account-lines-reconciliation-note">
            {reconciliationNote(reconciliation.status, reconciliation.tolerance)}
          </p>
          <div className="eia-table-wrap" style={{ marginBottom: 14 }}>
            <table className="eia-table" aria-label="Line reconciliation">
              <thead>
                <tr>
                  <th>Header component</th>
                  <th>Header</th>
                  <th>Lines</th>
                  <th>Difference</th>
                  <th>Within {reconciliation.tolerance.toFixed(2)}</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.components.map((row) => (
                  <tr key={row.key} data-testid={`technical-account-reconciliation-${row.key}`}>
                    <td>{row.label}</td>
                    <td data-testid={`technical-account-reconciliation-${row.key}-header`}>
                      {formatAmount(row.header, rowCurrency)}
                    </td>
                    <td data-testid={`technical-account-reconciliation-${row.key}-lines`}>
                      {formatAmount(row.lines, rowCurrency)}
                    </td>
                    <td data-testid={`technical-account-reconciliation-${row.key}-difference`}>
                      {formatAmount(row.difference, rowCurrency)}
                    </td>
                    <td>
                      <span className={`eia-pill ${row.withinTolerance ? 'green' : 'red'}`}>
                        {row.withinTolerance ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {message && (
            <p role="status" data-testid="technical-account-line-message">{message}</p>
          )}
          {actionError && (
            <p role="alert" data-testid="technical-account-line-error">{actionError}</p>
          )}

          {editable ? (
            <form
              className="eia-form-grid eia-line-form"
              onSubmit={submit}
              aria-label="Add statement line"
              data-testid="technical-account-line-form"
            >
              <div className="eia-field">
                <label htmlFor={`technical-account-line-type-${id}`}>Line type</label>
                <select
                  id={`technical-account-line-type-${id}`}
                  value={form.lineType}
                  onChange={(event) => update('lineType', event.target.value)}
                  required
                >
                  {TECHNICAL_ACCOUNT_LINE_TYPES.map((type) => (
                    <option key={type} value={type}>{lineTypeLabel(type)}</option>
                  ))}
                </select>
              </div>
              <div className="eia-field">
                <label htmlFor={`technical-account-line-reference-${id}`}>Reference</label>
                <input
                  id={`technical-account-line-reference-${id}`}
                  maxLength={64}
                  placeholder="BORD-2026-001"
                  value={form.reference}
                  onChange={(event) => update('reference', event.target.value)}
                />
              </div>
              <div className="eia-field span-2">
                <label htmlFor={`technical-account-line-description-${id}`}>Description</label>
                <input
                  id={`technical-account-line-description-${id}`}
                  maxLength={255}
                  placeholder="Q1 premium, paid loss, reinstatement premium…"
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                />
              </div>
              <div className="eia-field">
                <label htmlFor={`technical-account-line-amount-${id}`}>Amount</label>
                <input
                  id={`technical-account-line-amount-${id}`}
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  placeholder="1000000.00"
                  value={form.amount}
                  onChange={(event) => update('amount', event.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <button type="submit" disabled={busy}>
                  {busy ? 'Adding…' : 'Add line'}
                </button>
              </div>
              {formError && (
                <p
                  role="alert"
                  className="span-3"
                  data-testid="technical-account-line-form-error"
                >
                  {formError}
                </p>
              )}
            </form>
          ) : (
            <p className="eia-muted" data-testid="technical-account-lines-readonly">
              This statement is {status}. Its lines are immutable: no line can be added or
              deleted.
            </p>
          )}
        </>
      )}
    </section>
  );
}
