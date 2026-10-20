import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';

const contract = {
  id: CONTRACT_ID,
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: '44444444-4444-7444-8444-444444444444',
  status: 'BOUND',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 5
};

function cashCall(overrides = {}) {
  return {
    cashCallId: 'cc-10',
    tenantId: TENANT,
    contractId: CONTRACT_ID,
    callNumber: 'CC-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '100000.0000',
    currency: 'USD',
    dueDate: '2026-04-15',
    status: 'REQUESTED',
    notes: 'Q1 funding',
    createdAt: '2026-04-01T09:30:00Z',
    ...overrides
  };
}

function emptyState(cashCalls = []) {
  return {
    cashCalls,
    listRequests: [],
    posts: [],
    patches: [],
    listError: null,
    createError: null,
    statusError: null,
    listDelay: 0
  };
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks every contract endpoint the workbench touches on selection, plus the
 * cash-call collection and status routes. Mutating handlers update the
 * in-memory cash calls so the panel's reload sees the new state.
 */
async function mockContractApi(page, state) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const tenant = request.headers()['x-eia-tenant'];
    const base = `/api/v1/contracts/${CONTRACT_ID}`;

    if (method === 'GET' && path === '/api/v1/contracts') {
      await json(route, 200, [contract]);
      return;
    }
    if (method === 'GET' && path === `${base}/bind-eligibility`) {
      await json(route, 200, { contractId: CONTRACT_ID, bindable: false, checks: [] });
      return;
    }
    if (
      method === 'GET'
      && [`${base}/layers`, `${base}/participants`, `${base}/cessions`].includes(path)
    ) {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && (path === '/api/v1/assumed-claims/search' || path === '/api/v1/retrocessions/search')) {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/documents') {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/parties/')) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }

    if (path === `${base}/cash-calls`) {
      if (method === 'GET') {
        state.listRequests.push({ path, tenant });
        if (state.listDelay) {
          await new Promise((resolve) => setTimeout(resolve, state.listDelay));
        }
        if (state.listError) {
          await json(route, state.listError.status, state.listError.body);
          return;
        }
        await json(route, 200, state.cashCalls);
        return;
      }
      if (method === 'POST') {
        const body = request.postDataJSON();
        state.posts.push({ path, body, tenant });
        if (state.createError) {
          await json(route, state.createError.status, state.createError.body);
          return;
        }
        const created = {
          cashCallId: `cc-${state.cashCalls.length + 1}`,
          tenantId: TENANT,
          contractId: CONTRACT_ID,
          callNumber: 'CC-2026-00077',
          ...body,
          status: 'REQUESTED',
          createdAt: '2026-04-01T09:30:00Z'
        };
        state.cashCalls.push(created);
        await json(route, 201, created);
        return;
      }
    }

    const statusMatch = path.match(/^\/api\/v1\/contracts\/([^/]+)\/cash-calls\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch && statusMatch[1] === CONTRACT_ID) {
      const body = request.postDataJSON();
      state.patches.push({ path, body, tenant, cashCallId: statusMatch[2] });
      if (state.statusError) {
        await json(route, state.statusError.status, state.statusError.body);
        return;
      }
      const row = state.cashCalls.find((candidate) => candidate.cashCallId === statusMatch[2]);
      if (row) {
        row.status = body.status;
      }
      await json(route, 200, row || {});
      return;
    }

    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openCashCalls(page) {
  await page.goto(`/?record=${CONTRACT_ID}`);
  await expect(page.getByRole('heading', { name: contract.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Cash calls', exact: true }).click();
  await expect(page.getByTestId('cash-calls-panel')).toBeVisible();
}

test('lists cash calls newest period first with counts, amounts, overdue due dates, and actions', async ({ page }) => {
  const q1Request = cashCall({
    cashCallId: 'cc-10',
    callNumber: 'CC-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '100000.0000',
    dueDate: '2000-01-01',
    status: 'REQUESTED',
    notes: 'Cedent cash need'
  });
  const q2Issued = cashCall({
    cashCallId: 'cc-20',
    callNumber: 'CC-2026-00020',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    amount: '200000.0000',
    dueDate: '2000-01-01',
    status: 'ISSUED',
    notes: ''
  });
  const q3Issued = cashCall({
    cashCallId: 'cc-30',
    callNumber: 'CC-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    amount: '300000.0000',
    dueDate: '2999-12-31',
    status: 'ISSUED',
    notes: 'Large loss funding'
  });
  const q4Settled = cashCall({
    cashCallId: 'cc-40',
    callNumber: 'CC-2026-00040',
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
    amount: '400000.0000',
    dueDate: '2000-01-01',
    status: 'SETTLED',
    notes: 'Settled in Q1'
  });
  const q1Cancelled = cashCall({
    cashCallId: 'cc-50',
    callNumber: 'CC-2026-00005',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '500000.0000',
    dueDate: '2000-01-01',
    status: 'CANCELLED',
    notes: 'Withdrawn'
  });
  const state = emptyState([q1Request, q2Issued, q3Issued, q4Settled, q1Cancelled]);
  state.listDelay = 1000;
  await mockContractApi(page, state);

  await openCashCalls(page);

  // The tab sits directly after Technical accounts and loading stays in the panel.
  const tabNames = await page.locator('.eia-tabs .eia-tab').allTextContents();
  expect(tabNames.indexOf('Cash calls')).toBe(tabNames.indexOf('Technical accounts') + 1);
  await expect(page.getByTestId('cash-call-loading')).toBeVisible();
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('…');

  await expect.poll(() => state.listRequests.length).toBe(1);
  expect(state.listRequests).toEqual([
    { path: `/api/v1/contracts/${CONTRACT_ID}/cash-calls`, tenant: TENANT }
  ]);

  const rows = page.getByTestId('cash-call-row');
  await expect(rows).toHaveCount(5);

  // The service returns insertion order; the panel must show the newest period first.
  await expect(rows.nth(0).getByTestId('cash-call-number')).toHaveText('CC-2026-00040');
  await expect(rows.nth(0).getByTestId('cash-call-period')).toHaveText('2026-10-01 → 2026-12-31');
  await expect(rows.nth(0).getByTestId('cash-call-amount')).toContainText('$400,000.00');
  await expect(rows.nth(0).getByTestId('cash-call-amount')).toContainText('USD');
  await expect(rows.nth(0).getByTestId('cash-call-currency')).toHaveText('USD');
  await expect(rows.nth(0).getByTestId('cash-call-due-date')).toHaveText('2000-01-01');
  await expect(rows.nth(0).getByTestId('cash-call-status')).toHaveText('SETTLED');
  await expect(rows.nth(0).getByTestId('cash-call-status')).toHaveClass(/green/);
  await expect(rows.nth(0).getByTestId('cash-call-notes')).toHaveText('Settled in Q1');
  await expect(rows.nth(0).getByTestId('cash-call-action')).toHaveText('—');

  await expect(rows.nth(1).getByTestId('cash-call-number')).toHaveText('CC-2026-00030');
  await expect(rows.nth(1).getByTestId('cash-call-due-date')).toHaveText('2999-12-31');
  await expect(rows.nth(1).getByTestId('cash-call-status')).toHaveText('ISSUED');
  await expect(rows.nth(1).getByTestId('cash-call-status')).toHaveClass(/blue/);
  await expect(rows.nth(1).getByRole('button', { name: 'Settle' })).toBeVisible();

  await expect(rows.nth(2).getByTestId('cash-call-number')).toHaveText('CC-2026-00020');
  await expect(rows.nth(2).getByTestId('cash-call-notes')).toHaveText('—');
  await expect(rows.nth(2).getByRole('button', { name: 'Settle' })).toBeVisible();

  await expect(rows.nth(3).getByTestId('cash-call-number')).toHaveText('CC-2026-00010');
  await expect(rows.nth(3).getByTestId('cash-call-status')).toHaveText('REQUESTED');
  await expect(rows.nth(3).getByTestId('cash-call-status')).toHaveClass(/amber/);
  await expect(rows.nth(3).getByRole('button', { name: 'Issue' })).toBeVisible();
  await expect(rows.nth(3).getByRole('button', { name: 'Cancel' })).toBeVisible();

  await expect(rows.nth(4).getByTestId('cash-call-number')).toHaveText('CC-2026-00005');
  await expect(rows.nth(4).getByTestId('cash-call-status')).toHaveText('CANCELLED');
  await expect(rows.nth(4).getByTestId('cash-call-status')).toHaveClass(/red/);
  await expect(rows.nth(4).getByTestId('cash-call-action')).toHaveText('—');

  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('1');
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('2');
  await expect(page.getByTestId('cash-call-summary-issued-amount')).toHaveText('$500,000.00');
  await expect(page.getByTestId('cash-call-summary-settled-amount')).toHaveText('$400,000.00');
  // Only open calls past their due date are overdue; settled and cancelled are terminal.
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('2');
  await expect(page.getByTestId('cash-call-count')).toHaveText('5 cash calls');

  const note = page.getByTestId('cash-call-context-note');
  await expect(note).toContainText('requests funding from the cedent or reinsurer');
  await expect(note).toContainText('It is not a Payment');
  await expect(note).toContainText('Payment and FS-RI own execution');
  await expect(note).toContainText('never changes the contract record');
});

test('creates a cash call with the period, positive amount, currency, due date, and notes', async ({ page }) => {
  const state = emptyState();
  await mockContractApi(page, state);

  await openCashCalls(page);
  await expect(page.getByTestId('cash-call-empty')).toHaveText(
    'No cash calls yet for this contract.'
  );
  await expect(page.getByTestId('cash-call-loading')).toHaveCount(0);

  // An inverted period is rejected locally and never posted.
  await page.getByLabel('Period start').fill('2026-04-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Amount').fill('1000000');
  await page.getByLabel('Due date').fill('2026-05-15');
  await page.getByRole('button', { name: 'Request cash call' }).click();
  await expect(page.getByTestId('cash-call-error')).toContainText(
    'Period end must be after period start.'
  );
  expect(state.posts).toHaveLength(0);

  // A zero amount is rejected locally as well.
  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Amount').fill('0');
  await page.getByRole('button', { name: 'Request cash call' }).click();
  await expect(page.getByTestId('cash-call-error')).toContainText(
    'Amount must be greater than zero.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Amount').fill('1500000');
  await page.getByLabel('Due date').fill('2027-04-15');
  await page.getByLabel('Notes').fill('Q1 funding request');
  await page.getByRole('button', { name: 'Request cash call' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].path).toBe(`/api/v1/contracts/${CONTRACT_ID}/cash-calls`);
  expect(state.posts[0].tenant).toBe(TENANT);
  expect(state.posts[0].body).toEqual({
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    amount: '1500000.0000',
    currency: 'USD',
    dueDate: '2027-04-15',
    notes: 'Q1 funding request'
  });

  await expect(page.getByTestId('cash-call-message')).toHaveText(
    'Cash call CC-2026-00077 requested.'
  );
  const row = page.getByTestId('cash-call-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('cash-call-number')).toHaveText('CC-2026-00077');
  await expect(row.getByTestId('cash-call-period')).toHaveText('2026-01-01 → 2026-03-31');
  await expect(row.getByTestId('cash-call-amount')).toContainText('$1,500,000.00');
  await expect(row.getByTestId('cash-call-due-date')).toHaveText('2027-04-15');
  await expect(row.getByTestId('cash-call-status')).toHaveText('REQUESTED');
  await expect(row.getByTestId('cash-call-notes')).toHaveText('Q1 funding request');
  await expect(row.getByRole('button', { name: 'Issue' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible();

  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('1');
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('0');
  await expect(page.getByTestId('cash-call-summary-issued-amount')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-settled-amount')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('0');

  // The form is ready for the next request.
  await expect(page.getByLabel('Period start')).toHaveValue('');
  await expect(page.getByLabel('Amount')).toHaveValue('');
  await expect(page.getByLabel('Notes')).toHaveValue('');
});

test('issues and settles a cash call only after confirmation', async ({ page }) => {
  const requested = cashCall({
    cashCallId: 'cc-30',
    callNumber: 'CC-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    amount: '1200000.0000',
    dueDate: '2026-10-31',
    status: 'REQUESTED',
    notes: 'Large loss funding'
  });
  const state = emptyState([requested]);
  await mockContractApi(page, state);

  const dialogs = [];
  let acceptDialogs = false;
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    if (acceptDialogs) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await openCashCalls(page);
  const row = page.getByTestId('cash-call-row');
  await expect(row.getByTestId('cash-call-status')).toHaveText('REQUESTED');

  // Dismissing the confirmation sends nothing.
  await row.getByRole('button', { name: 'Issue' }).click();
  await page.waitForTimeout(200);
  expect(state.patches).toHaveLength(0);
  await expect(row.getByTestId('cash-call-status')).toHaveText('REQUESTED');
  await expect(page.getByTestId('cash-call-message')).toHaveCount(0);
  dialogs.length = 0;

  acceptDialogs = true;
  await row.getByRole('button', { name: 'Issue' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/cash-calls/cc-30/status`,
    body: { status: 'ISSUED' },
    tenant: TENANT,
    cashCallId: 'cc-30'
  });
  await expect(row.getByTestId('cash-call-status')).toHaveText('ISSUED');
  await expect(row.getByTestId('cash-call-status')).toHaveClass(/blue/);
  await expect(row.getByRole('button', { name: 'Settle' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Issue' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByTestId('cash-call-message')).toHaveText(
    'Cash call CC-2026-00030 issued.'
  );
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('0');
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('1');
  await expect(page.getByTestId('cash-call-summary-issued-amount')).toHaveText('$1,200,000.00');

  await row.getByRole('button', { name: 'Settle' }).click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/cash-calls/cc-30/status`,
    body: { status: 'SETTLED' },
    tenant: TENANT,
    cashCallId: 'cc-30'
  });
  await expect(row.getByTestId('cash-call-status')).toHaveText('SETTLED');
  await expect(row.getByTestId('cash-call-status')).toHaveClass(/green/);
  await expect(row.getByTestId('cash-call-action')).toHaveText('—');
  await expect(page.getByTestId('cash-call-message')).toHaveText(
    'Cash call CC-2026-00030 settled.'
  );
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('0');
  await expect(page.getByTestId('cash-call-summary-issued-amount')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-settled-amount')).toHaveText('$1,200,000.00');

  expect(dialogs).toHaveLength(2);
  expect(dialogs[0]).toContain('Issue cash call CC-2026-00030 for 2026-07-01 → 2026-09-30');
  expect(dialogs[0]).toContain('not a Payment');
  expect(dialogs[0]).toContain('Payment and FS-RI own execution');
  expect(dialogs[1]).toContain('Settle cash call CC-2026-00030 for 2026-07-01 → 2026-09-30');
  expect(dialogs[1]).toContain('Payment and FS-RI own execution');
});

test('cancels a requested cash call only after confirmation', async ({ page }) => {
  const requested = cashCall({
    cashCallId: 'cc-40',
    callNumber: 'CC-2026-00040',
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
    amount: '900000.0000',
    dueDate: '2000-01-01',
    status: 'REQUESTED',
    notes: 'Superseded request'
  });
  const state = emptyState([requested]);
  await mockContractApi(page, state);

  const dialogs = [];
  let acceptDialogs = false;
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    if (acceptDialogs) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await openCashCalls(page);
  const row = page.getByTestId('cash-call-row');
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('1');

  await row.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(200);
  expect(state.patches).toHaveLength(0);
  await expect(row.getByTestId('cash-call-status')).toHaveText('REQUESTED');
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('1');
  dialogs.length = 0;

  acceptDialogs = true;
  await row.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/cash-calls/cc-40/status`,
    body: { status: 'CANCELLED' },
    tenant: TENANT,
    cashCallId: 'cc-40'
  });
  await expect(row.getByTestId('cash-call-status')).toHaveText('CANCELLED');
  await expect(row.getByTestId('cash-call-status')).toHaveClass(/red/);
  await expect(row.getByTestId('cash-call-action')).toHaveText('—');
  await expect(page.getByTestId('cash-call-message')).toHaveText(
    'Cash call CC-2026-00040 cancelled.'
  );
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('0');
  // A cancelled request is terminal, so its past due date is no longer overdue.
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('0');

  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('Cancel cash call CC-2026-00040 for 2026-10-01 → 2026-12-31');
  expect(dialogs[0]).toContain('withdraws the funding request');
  expect(dialogs[0]).toContain('not a Payment');
});

test('shows the empty state, zero counts, and the funding-request context note', async ({ page }) => {
  await mockContractApi(page, emptyState());

  await openCashCalls(page);
  await expect(page.getByTestId('cash-call-empty')).toBeVisible();
  await expect(page.getByTestId('cash-call-loading')).toHaveCount(0);
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('0');
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('0');
  await expect(page.getByTestId('cash-call-summary-issued-amount')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-settled-amount')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('0');
  await expect(page.getByTestId('cash-call-count')).toHaveText('0 cash calls');
  await expect(page.getByTestId('cash-call-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request cash call' })).toBeVisible();
  await expect(page.getByTestId('cash-call-context-note')).toContainText('It is not a Payment');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
});

test('contains a cash-call load failure inside the panel', async ({ page }) => {
  const state = emptyState();
  state.listError = {
    status: 503,
    body: {
      code: 'CASH_CALL_SERVICE_UNAVAILABLE',
      message: 'Funding request store unavailable'
    }
  };
  await mockContractApi(page, state);

  await openCashCalls(page);
  const error = page.getByTestId('cash-call-error');
  await expect(error).toContainText('Cash calls could not be loaded');
  await expect(error).toContainText('CASH_CALL_SERVICE_UNAVAILABLE: Funding request store unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(page.getByTestId('cash-call-empty')).toHaveCount(0);
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-issued')).toHaveText('—');
  await expect(page.getByTestId('cash-call-summary-overdue')).toHaveText('—');
  await expect(page.getByTestId('cash-call-count')).toHaveText('—');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');

  // The record remains usable after the contained failure.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contract details' })).toBeVisible();
});

test('shows a 409 when a status transition loses the race, reloading the row', async ({ page }) => {
  const requested = cashCall({
    cashCallId: 'cc-20',
    callNumber: 'CC-2026-00020',
    amount: '250000.0000',
    status: 'REQUESTED'
  });
  const state = emptyState([requested]);
  state.statusError = {
    status: 409,
    body: {
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Cash-call status cannot move from SETTLED to ISSUED'
    }
  };
  await mockContractApi(page, state);

  page.on('dialog', (dialog) => dialog.accept());
  await openCashCalls(page);

  await page.getByTestId('cash-call-row').getByRole('button', { name: 'Issue' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  const error = page.getByTestId('cash-call-error');
  await expect(error).toContainText('INVALID_STATUS_TRANSITION');
  await expect(error).toContainText('Cash-call status cannot move from SETTLED to ISSUED');
  await expect(page.getByTestId('cash-call-row').getByTestId('cash-call-status')).toHaveText('REQUESTED');
  await expect(page.getByTestId('cash-call-message')).toHaveCount(0);
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
});

test('shows a 409 on create, keeping the entered form', async ({ page }) => {
  const state = emptyState();
  state.createError = {
    status: 409,
    body: {
      code: 'CASH_CALL_CONFLICT',
      message: 'A cash call already exists for this contract period'
    }
  };
  await mockContractApi(page, state);

  await openCashCalls(page);
  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Amount').fill('1500000');
  await page.getByLabel('Due date').fill('2026-04-15');
  await page.getByLabel('Notes').fill('Q1 funding request');
  await page.getByRole('button', { name: 'Request cash call' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  const error = page.getByTestId('cash-call-error');
  await expect(error).toContainText('CASH_CALL_CONFLICT');
  await expect(error).toContainText('A cash call already exists for this contract period');
  await expect(page.getByLabel('Period start')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('Amount')).toHaveValue('1500000');
  await expect(page.getByLabel('Notes')).toHaveValue('Q1 funding request');
  await expect(page.getByTestId('cash-call-empty')).toBeVisible();
  await expect(page.getByTestId('cash-call-message')).toHaveCount(0);
  await expect(page.getByTestId('cash-call-summary-requested')).toHaveText('0');
});
