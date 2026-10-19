export const TENANT = '11111111-1111-7111-8111-111111111111';

export const APPROVER = '66666666-6666-7666-8666-666666666666';

export async function apiFetch(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT, ...(options.headers || {}) };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = new Error((payload && payload.message) || `Request failed: ${response.status}`);
    error.code = payload && payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function errorMessage(error) {
  if (!error) {
    return '';
  }
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}
