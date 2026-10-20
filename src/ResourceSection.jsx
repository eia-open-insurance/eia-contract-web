import React, { useEffect, useState } from 'react';
import { apiFetch, errorMessage, formatValue } from './api';

function initialForm(fields) {
  const form = {};
  for (const field of fields) {
    form[field.name] = field.defaultValue ?? (field.type === 'checkbox' ? false : '');
  }
  return form;
}

function payloadOf(fields, form) {
  const payload = {};
  for (const field of fields) {
    const raw = form[field.name];
    if (field.type === 'checkbox') {
      payload[field.name] = Boolean(raw);
      continue;
    }
    if (raw === '' || raw === undefined || raw === null) {
      continue;
    }
    payload[field.name] = field.type === 'number' ? Number(raw) : raw;
  }
  return payload;
}

/**
 * Generic child-resource section: a list table plus a create form.
 *
 * <p>Columns and fields are declarative so every tab uses the same behaviour and the
 * same accessible labels. Money stays a decimal string end-to-end.</p>
 */
export default function ResourceSection({
  title,
  description,
  resource,
  contractId,
  columns,
  fields,
  rowActions,
  onChanged,
  transform,
  testId
}) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm(fields));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const fieldId = (name) => `${testId || resource}-${name}`;

  async function load() {
    if (!contractId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch(`/api/v1/contracts/${contractId}/${resource}`);
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [contractId, resource]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const payload = payloadOf(fields, form);
      await apiFetch(`/api/v1/contracts/${contractId}/${resource}`, {
        method: 'POST',
        body: JSON.stringify(transform ? transform(payload) : payload)
      });
      setForm(initialForm(fields));
      setMessage(`${title.replace(/s$/, '')} recorded.`);
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

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  if (!contractId) {
    return (
      <section aria-label={title} data-testid={testId}>
        <div className="eia-section-title">
          <h2>{title}</h2>
        </div>
        <div className="eia-empty">Select a contract from the register to work with its {title.toLowerCase()}.</div>
      </section>
    );
  }

  return (
    <section aria-label={title} data-testid={testId}>
      <div className="eia-section-title">
        <h2>{title}</h2>
        <span className="eia-muted">
          {rows.length} record{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      {description && <p className="eia-muted">{description}</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <form className="eia-form-grid" onSubmit={submit} style={{ margin: '12px 0 16px' }}>
        {fields.map((field) => (
          <div className="eia-field" key={field.name}>
            <label htmlFor={fieldId(field.name)}>{field.label}</label>
            {field.type === 'select' ? (
              <select
                id={fieldId(field.name)}
                value={form[field.name] ?? ''}
                onChange={(e) => update(field.name, e.target.value)}
                required={field.required}
              >
                <option value="">—</option>
                {(field.options || []).map((option) => (
                  <option key={option.value ?? option} value={option.value ?? option}>
                    {option.label ?? option}
                  </option>
                ))}
              </select>
            ) : field.type === 'checkbox' ? (
              <input
                id={fieldId(field.name)}
                type="checkbox"
                checked={Boolean(form[field.name])}
                onChange={(e) => update(field.name, e.target.checked)}
              />
            ) : (
              <input
                id={fieldId(field.name)}
                type={field.type || 'text'}
                step={field.type === 'number' ? '1' : undefined}
                placeholder={field.placeholder}
                value={form[field.name] ?? ''}
                onChange={(e) => update(field.name, e.target.value)}
                required={field.required}
              />
            )}
          </div>
        ))}
        <div className="eia-field">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : `Add ${title.replace(/s$/, '').toLowerCase()}`}
          </button>
        </div>
      </form>

      <div className="eia-table-wrap">
        <table className="eia-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {rowActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.render ? column.render(row) : formatValue(row[column.key])}
                  </td>
                ))}
                {rowActions && (
                  <td>
                    {rowActions(row, async () => {
                      await load();
                      if (onChanged) {
                        onChanged();
                      }
                    }, (e) => setError(errorMessage(e)))}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td className="eia-muted" colSpan={columns.length + (rowActions ? 1 : 0)}>
                  No records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
