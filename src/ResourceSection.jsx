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
      <section aria-label={title}>
        <h2>{title}</h2>
        <p>Select a contract on the Contracts tab to work with its {title.toLowerCase()}.</p>
      </section>
    );
  }

  return (
    <section aria-label={title} data-testid={testId}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      {message && <p role="status" style={{ color: '#0b6b3a' }}>{message}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, margin: '12px 0 20px', maxWidth: 680 }}>
        {fields.map((field) => (
          <label key={field.name} style={{ display: 'grid', gap: 4 }}>
            <span>{field.label}</span>
            {field.type === 'select' ? (
              <select
                aria-label={field.label}
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
                aria-label={field.label}
                type="checkbox"
                checked={Boolean(form[field.name])}
                onChange={(e) => update(field.name, e.target.checked)}
              />
            ) : (
              <input
                aria-label={field.label}
                type={field.type || 'text'}
                step={field.type === 'number' ? '1' : undefined}
                placeholder={field.placeholder}
                value={form[field.name] ?? ''}
                onChange={(e) => update(field.name, e.target.value)}
                required={field.required}
              />
            )}
          </label>
        ))}
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : `Add ${title.replace(/s$/, '').toLowerCase()}`}</button>
      </form>
      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} align="left">{column.label}</th>
            ))}
            {rowActions && <th align="left">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderTop: '1px solid #ddd' }}>
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
              <td colSpan={columns.length + (rowActions ? 1 : 0)}>No records yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
