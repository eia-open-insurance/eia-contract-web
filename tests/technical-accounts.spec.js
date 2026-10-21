import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';

// The full add-line domain: every option the form must offer and the bucket the
// totals and reconciliation tables must roll it into.
const LINE_TYPE_OPTIONS = [
  ['PREMIUM', 'Premium', 'Premium'],
  ['COMMISSION', 'Commission', 'Commission'],
  ['BROKERAGE', 'Brokerage', 'Commission'],
  ['PAID_LOSS', 'Paid loss', 'Loss'],
  ['OUTSTANDING_LOSS', 'Outstanding loss', 'Loss'],
  ['IBNR', 'IBNR', 'Loss'],
  ['ALAE', 'ALAE', 'Loss'],
  ['REINSTATEMENT', 'Reinstatement', 'Loss'],
  ['CASH_CALL', 'Cash call', 'Loss'],
  ['FUNDS_WITHHELD', 'Funds withheld', 'Other'],
  ['TAX', 'Tax', 'Other'],
  ['ADJUSTMENT', 'Adjustment', 'Other'],
  ['OTHER', 'Other', 'Other']
];

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

function account(overrides = {}) {
  return {
    accountId: 'ta-10',
    tenantId: TENANT,
    contractId: CONTRACT_ID,
    accountNumber: 'TA-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    currency: 'USD',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    otherCharges: '0.0000',
    balance: '650000.0000',
    status: 'DRAFT',
    createdAt: '2026-04-01T09:30:00Z',
    ...overrides
  };
}

function emptyState(accounts = []) {
  return {
    accounts,
    lines: {},
    listRequests: [],
    lineRequests: [],
    posts: [],
    linePosts: [],
    lineDeletes: [],
    patches: [],
    listError: null,
    createError: null,
    statusError: null,
    lineListError: null,
    lineCreateError: null,
    lineDeleteError: null
  };
}

function accountLine(overrides = {}) {
  return {
    id: 'line-1',
    tenantId: TENANT,
    accountId: 'ta-30',
    lineType: 'PREMIUM',
    reference: 'BORD-2026-001',
    description: 'Q1 premium',
    amount: '1000000.0000',
    createdAt: '2026-04-01T09:30:00Z',
    ...overrides
  };
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function usd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function balanceOf(body) {
  const total = Number(body.cededPremium || 0)
    - Number(body.cededLosses || 0)
    - Number(body.commission || 0)
    + Number(body.otherCharges || 0);
  return total.toFixed(4);
}

function totalsOf(lines) {
  const totals = { premium: 0, loss: 0, commission: 0, other: 0 };
  const buckets = {
    PREMIUM: 'premium',
    COMMISSION: 'commission',
    BROKERAGE: 'commission',
    PAID_LOSS: 'loss',
    OUTSTANDING_LOSS: 'loss',
    IBNR: 'loss',
    ALAE: 'loss',
    REINSTATEMENT: 'loss',
    CASH_CALL: 'loss',
    FUNDS_WITHHELD: 'other',
    TAX: 'other',
    ADJUSTMENT: 'other',
    OTHER: 'other'
  };
  for (const line of lines) {
    const key = buckets[String(line.lineType || '').toUpperCase()] || 'other';
    totals[key] += Number(line.amount || 0);
  }
  return {
    premium: totals.premium.toFixed(4),
    loss: totals.loss.toFixed(4),
    commission: totals.commission.toFixed(4),
    other: totals.other.toFixed(4)
  };
}

/**
 * Mocks every contract endpoint the workbench touches on selection, plus the
 * technical-account collection and status routes. Mutating handlers update the
 * in-memory accounts so the panel's reload sees the new state.
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

    if (path === `${base}/technical-accounts`) {
      if (method === 'GET') {
        state.listRequests.push({ path, tenant });
        if (state.listError) {
          await json(route, state.listError.status, state.listError.body);
          return;
        }
        await json(route, 200, state.accounts);
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
          accountId: `ta-${state.accounts.length + 1}`,
          tenantId: TENANT,
          contractId: CONTRACT_ID,
          accountNumber: 'TA-2026-00077',
          ...body,
          balance: balanceOf(body),
          status: 'DRAFT',
          createdAt: '2026-04-01T09:30:00Z'
        };
        state.accounts.push(created);
        await json(route, 201, created);
        return;
      }
    }

    const linesMatch = path.match(
      /^\/api\/v1\/contracts\/([^/]+)\/technical-accounts\/([^/]+)\/lines$/
    );
    if (linesMatch && linesMatch[1] === CONTRACT_ID) {
      const accountId = linesMatch[2];
      const bucket = state.lines[accountId] || (state.lines[accountId] = []);
      if (method === 'GET') {
        state.lineRequests.push({ path, tenant, accountId });
        if (state.lineListError) {
          await json(route, state.lineListError.status, state.lineListError.body);
          return;
        }
        await json(route, 200, {
          items: bucket,
          totals: totalsOf(bucket)
        });
        return;
      }
      if (method === 'POST') {
        const body = request.postDataJSON();
        state.linePosts.push({ path, body, tenant, accountId });
        if (state.lineCreateError) {
          await json(route, state.lineCreateError.status, state.lineCreateError.body);
          return;
        }
        const created = {
          id: `line-${bucket.length + 1}`,
          tenantId: TENANT,
          accountId,
          lineType: body.lineType,
          reference: body.reference ?? null,
          description: body.description ?? null,
          amount: body.amount,
          createdAt: '2026-04-01T09:30:00Z'
        };
        bucket.push(created);
        await json(route, 201, created);
        return;
      }
    }

    const lineMatch = path.match(
      /^\/api\/v1\/contracts\/([^/]+)\/technical-accounts\/([^/]+)\/lines\/([^/]+)$/
    );
    if (method === 'DELETE' && lineMatch && lineMatch[1] === CONTRACT_ID) {
      const [, , accountId, lineId] = lineMatch;
      state.lineDeletes.push({ path, tenant, accountId, lineId });
      if (state.lineDeleteError) {
        await json(route, state.lineDeleteError.status, state.lineDeleteError.body);
        return;
      }
      state.lines[accountId] = (state.lines[accountId] || [])
        .filter((candidate) => String(candidate.id) !== lineId);
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    const statusMatch = path.match(/^\/api\/v1\/contracts\/([^/]+)\/technical-accounts\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch && statusMatch[1] === CONTRACT_ID) {
      const body = request.postDataJSON();
      state.patches.push({ path, body, tenant, accountId: statusMatch[2] });
      if (state.statusError) {
        await json(route, state.statusError.status, state.statusError.body);
        return;
      }
      const row = state.accounts.find((candidate) => candidate.accountId === statusMatch[2]);
      if (row) {
        row.status = body.status;
      }
      await json(route, 200, row || {});
      return;
    }

    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openTechnicalAccounts(page) {
  await page.goto(`/?record=${CONTRACT_ID}`);
  await expect(page.getByRole('heading', { name: contract.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Technical accounts', exact: true }).click();
  await expect(page.getByTestId('technical-accounts-panel')).toBeVisible();
}

async function expandLines(page, index = 0) {
  await page.getByTestId('technical-account-expand').nth(index).click();
  await expect(page.getByTestId('technical-account-lines-panel')).toBeVisible();
}

test('lists technical accounts newest period first with the ceded totals and issued-only balance', async ({ page }) => {
  const firstQuarter = account({
    accountId: 'ta-10',
    accountNumber: 'TA-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    balance: '650000.0000',
    status: 'SETTLED'
  });
  const secondQuarter = account({
    accountId: 'ta-20',
    accountNumber: 'TA-2026-00020',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    cededPremium: '2000000.0000',
    cededLosses: '500000.0000',
    commission: '200000.0000',
    balance: '1300000.0000',
    status: 'ISSUED'
  });
  const thirdQuarter = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '3000000.0000',
    cededLosses: '750000.0000',
    commission: '300000.0000',
    balance: '1950000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([firstQuarter, secondQuarter, thirdQuarter]);
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expect.poll(() => state.listRequests.length).toBe(1);
  expect(state.listRequests).toEqual([
    { path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts`, tenant: TENANT }
  ]);

  const rows = page.getByTestId('technical-account-row');
  await expect(rows).toHaveCount(3);

  // The service returns insertion order; the panel must show the newest period first.
  await expect(rows.nth(0).getByTestId('technical-account-number')).toHaveText('TA-2026-00030');
  await expect(rows.nth(0).getByTestId('technical-account-period')).toHaveText('2026-07-01 → 2026-09-30');
  await expect(rows.nth(0).getByTestId('technical-account-ceded-premium')).toHaveText('$3,000,000.00');
  await expect(rows.nth(0).getByTestId('technical-account-ceded-losses')).toHaveText('$750,000.00');
  await expect(rows.nth(0).getByTestId('technical-account-commission')).toHaveText('$300,000.00');
  await expect(rows.nth(0).getByTestId('technical-account-balance')).toHaveText('$1,950,000.00');
  await expect(rows.nth(0).getByTestId('technical-account-status')).toHaveText('DRAFT');
  await expect(rows.nth(0).getByTestId('technical-account-status')).toHaveClass(/amber/);
  await expect(rows.nth(0).getByRole('button', { name: 'Issue' })).toBeVisible();

  await expect(rows.nth(1).getByTestId('technical-account-number')).toHaveText('TA-2026-00020');
  await expect(rows.nth(1).getByTestId('technical-account-status')).toHaveText('ISSUED');
  await expect(rows.nth(1).getByTestId('technical-account-status')).toHaveClass(/blue/);
  await expect(rows.nth(1).getByRole('button', { name: 'Settle' })).toBeVisible();

  await expect(rows.nth(2).getByTestId('technical-account-number')).toHaveText('TA-2026-00010');
  await expect(rows.nth(2).getByTestId('technical-account-status')).toHaveText('SETTLED');
  await expect(rows.nth(2).getByTestId('technical-account-action')).toHaveText('—');

  await expect(page.getByTestId('technical-account-summary-premium')).toHaveText('$6,000,000.00');
  await expect(page.getByTestId('technical-account-summary-losses')).toHaveText('$1,500,000.00');
  await expect(page.getByTestId('technical-account-summary-commission')).toHaveText('$600,000.00');
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('$1,300,000.00');
  await expect(page.getByTestId('technical-account-summary-count')).toHaveText('3');
  await expect(page.getByTestId('technical-account-count')).toHaveText('3 accounts');

  const note = page.getByTestId('technical-account-context-note');
  await expect(note).toContainText('is a period statement');
  await expect(note).toContainText('contract remains the source of its terms');
  await expect(note).toContainText('FS-RI');
  await expect(note).toContainText('SAP');
  await expect(note).toContainText('posted amounts');
});

test('creates a technical account with the period, amounts, currency, and computed balance preview', async ({ page }) => {
  const state = emptyState();
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expect(page.getByTestId('technical-account-empty')).toHaveText(
    'No technical accounts yet for this contract.'
  );

  // An inverted period is rejected locally and never posted.
  await page.getByLabel('Period start').fill('2026-04-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Ceded premium').fill('1000000');
  await page.getByLabel('Ceded losses').fill('250000');
  await page.getByLabel('Commission').fill('100000');
  await page.getByLabel('Other charges').fill('5000');
  await page.getByRole('button', { name: 'Record technical account' }).click();
  await expect(page.getByTestId('technical-account-error')).toContainText(
    'Period end must be after period start.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await expect(page.getByTestId('technical-account-preview-amount')).toHaveText('$655,000.00');
  await expect(page.getByTestId('technical-account-preview-direction')).toHaveText(
    'Balance due to the reinsurer.'
  );

  await page.getByRole('button', { name: 'Record technical account' }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].path).toBe(`/api/v1/contracts/${CONTRACT_ID}/technical-accounts`);
  expect(state.posts[0].tenant).toBe(TENANT);
  expect(state.posts[0].body).toEqual({
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    currency: 'USD',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    otherCharges: '5000.0000'
  });

  await expect(page.getByTestId('technical-account-message')).toHaveText(
    'Technical account TA-2026-00077 recorded.'
  );
  const row = page.getByTestId('technical-account-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('technical-account-number')).toHaveText('TA-2026-00077');
  await expect(row.getByTestId('technical-account-period')).toHaveText('2026-01-01 → 2026-03-31');
  await expect(row.getByTestId('technical-account-status')).toHaveText('DRAFT');
  await expect(row.getByTestId('technical-account-balance')).toHaveText('$655,000.00');

  await expect(page.getByTestId('technical-account-summary-premium')).toHaveText('$1,000,000.00');
  await expect(page.getByTestId('technical-account-summary-losses')).toHaveText('$250,000.00');
  await expect(page.getByTestId('technical-account-summary-commission')).toHaveText('$100,000.00');
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('—');
  await expect(page.getByTestId('technical-account-summary-count')).toHaveText('1');

  // The form is ready for the next statement.
  await expect(page.getByLabel('Period start')).toHaveValue('');
  await expect(page.getByLabel('Ceded premium')).toHaveValue('');
  await expect(page.getByTestId('technical-account-preview-amount')).toHaveText('$0.00');
  await expect(page.getByTestId('technical-account-preview-direction')).toHaveText('Nil balance.');
});

test('issues a draft and settles an issued statement only after confirmation', async ({ page }) => {
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '3000000.0000',
    cededLosses: '750000.0000',
    commission: '300000.0000',
    balance: '1950000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
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

  await openTechnicalAccounts(page);
  const row = page.getByTestId('technical-account-row');
  await expect(row.getByTestId('technical-account-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('—');

  // Dismissing the confirmation sends nothing.
  await row.getByRole('button', { name: 'Issue' }).click();
  await page.waitForTimeout(200);
  expect(state.patches).toHaveLength(0);
  await expect(row.getByTestId('technical-account-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('technical-account-message')).toHaveCount(0);
  dialogs.length = 0;

  acceptDialogs = true;
  await row.getByRole('button', { name: 'Issue' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/status`,
    body: { status: 'ISSUED' },
    tenant: TENANT,
    accountId: 'ta-30'
  });
  await expect(row.getByTestId('technical-account-status')).toHaveText('ISSUED');
  await expect(row.getByTestId('technical-account-status')).toHaveClass(/blue/);
  await expect(row.getByRole('button', { name: 'Settle' })).toBeVisible();
  await expect(page.getByTestId('technical-account-message')).toHaveText(
    'Technical account TA-2026-00030 issued.'
  );
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('$1,950,000.00');

  await row.getByRole('button', { name: 'Settle' }).click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/status`,
    body: { status: 'SETTLED' },
    tenant: TENANT,
    accountId: 'ta-30'
  });
  await expect(row.getByTestId('technical-account-status')).toHaveText('SETTLED');
  await expect(row.getByTestId('technical-account-status')).toHaveClass(/green/);
  await expect(row.getByTestId('technical-account-action')).toHaveText('—');
  await expect(page.getByTestId('technical-account-message')).toHaveText(
    'Technical account TA-2026-00030 settled.'
  );
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('—');

  expect(dialogs).toHaveLength(2);
  expect(dialogs[0]).toContain('Issue technical account TA-2026-00030 for 2026-07-01 → 2026-09-30');
  expect(dialogs[0]).toContain('The contract remains the source of its terms.');
  expect(dialogs[1]).toContain('Settle technical account TA-2026-00030 for 2026-07-01 → 2026-09-30');
  expect(dialogs[1]).toContain('FS-RI and SAP own the posted amounts.');
});

test('shows the empty state, zero totals, and the statement context note', async ({ page }) => {
  await mockContractApi(page, emptyState());

  await openTechnicalAccounts(page);
  await expect(page.getByTestId('technical-account-empty')).toBeVisible();
  await expect(page.getByTestId('technical-account-loading')).toHaveCount(0);
  await expect(page.getByTestId('technical-account-summary-count')).toHaveText('0');
  await expect(page.getByTestId('technical-account-summary-premium')).toHaveText('—');
  await expect(page.getByTestId('technical-account-summary-losses')).toHaveText('—');
  await expect(page.getByTestId('technical-account-summary-commission')).toHaveText('—');
  await expect(page.getByTestId('technical-account-summary-outstanding')).toHaveText('—');
  await expect(page.getByTestId('technical-account-count')).toHaveText('0 accounts');
  await expect(page.getByTestId('technical-account-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record technical account' })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
});

test('contains a technical-account load failure inside the panel', async ({ page }) => {
  const state = emptyState();
  state.listError = {
    status: 503,
    body: {
      code: 'TECHNICAL_ACCOUNT_SERVICE_UNAVAILABLE',
      message: 'Statement store unavailable'
    }
  };
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  const error = page.getByTestId('technical-account-error');
  await expect(error).toContainText('Technical accounts could not be loaded');
  await expect(error).toContainText('TECHNICAL_ACCOUNT_SERVICE_UNAVAILABLE: Statement store unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(page.getByTestId('technical-account-empty')).toHaveCount(0);
  await expect(page.getByTestId('technical-account-summary-count')).toHaveText('—');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');

  // The record remains usable after the contained failure.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contract details' })).toBeVisible();
});

test('shows a 409 when a duplicate statement period is rejected, keeping the form', async ({ page }) => {
  const state = emptyState();
  state.createError = {
    status: 409,
    body: {
      code: 'DUPLICATE_TECHNICAL_ACCOUNT_PERIOD',
      message: 'A technical account already exists for contract period 2026-01-01 to 2026-03-31'
    }
  };
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Ceded premium').fill('1000000');
  await page.getByRole('button', { name: 'Record technical account' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  const error = page.getByTestId('technical-account-error');
  await expect(error).toContainText('DUPLICATE_TECHNICAL_ACCOUNT_PERIOD');
  await expect(error).toContainText(
    'A technical account already exists for contract period 2026-01-01 to 2026-03-31'
  );
  await expect(page.getByLabel('Period start')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('Ceded premium')).toHaveValue('1000000');
  await expect(page.getByTestId('technical-account-empty')).toBeVisible();
  await expect(page.getByTestId('technical-account-message')).toHaveCount(0);
  await expect(page.getByTestId('technical-account-summary-count')).toHaveText('0');
});

test('expands a statement to list its lines, totals by type, and a reconciled header', async ({ page }) => {
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    balance: '650000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  state.lines['ta-30'] = [
    accountLine({
      id: 'line-1',
      lineType: 'PREMIUM',
      reference: 'BORD-2026-001',
      description: 'Q1 premium',
      amount: '1000000.0000',
      sequence: 1
    }),
    accountLine({
      id: 'line-2',
      lineType: 'PAID_LOSS',
      reference: 'LOSS-2026-001',
      description: 'Q1 paid loss',
      amount: '250000.0000',
      sequence: 2
    }),
    accountLine({
      id: 'line-3',
      lineType: 'COMMISSION',
      reference: 'COMM-2026-001',
      description: 'Q1 ceding commission',
      amount: '100000.0000',
      sequence: 3
    })
  ];
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expect(page.getByTestId('technical-account-lines-panel')).toHaveCount(0);

  await expandLines(page);
  await expect.poll(() => state.lineRequests.length).toBe(1);
  expect(state.lineRequests[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/lines`,
    tenant: TENANT,
    accountId: 'ta-30'
  });

  const panel = page.getByTestId('technical-account-lines-panel');
  const lineRows = panel.getByTestId('technical-account-line-row');
  await expect(lineRows).toHaveCount(3);
  await expect(lineRows.nth(0).getByTestId('technical-account-line-type')).toHaveText('Premium');
  await expect(lineRows.nth(0).getByTestId('technical-account-line-reference')).toHaveText('BORD-2026-001');
  await expect(lineRows.nth(0).getByTestId('technical-account-line-description')).toHaveText('Q1 premium');
  await expect(lineRows.nth(0).getByTestId('technical-account-line-amount')).toHaveText('$1,000,000.00');
  await expect(lineRows.nth(1).getByTestId('technical-account-line-type')).toHaveText('Paid loss');
  await expect(lineRows.nth(2).getByTestId('technical-account-line-type')).toHaveText('Commission');

  await expect(panel.getByTestId('technical-account-line-count')).toHaveText('3 lines');
  await expect(panel.getByTestId('technical-account-line-total-PREMIUM')).toContainText('Premium');
  await expect(panel.getByTestId('technical-account-line-total-PAID_LOSS')).toContainText('Loss');
  await expect(panel.getByTestId('technical-account-line-total-COMMISSION')).toContainText('Commission');

  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Reconciled');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveClass(/green/);
  await expect(panel.getByTestId('technical-account-reconciliation-premium-header')).toHaveText('$1,000,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-premium-lines')).toHaveText('$1,000,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-losses-lines')).toHaveText('$250,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-commission-lines')).toHaveText('$100,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-balance-lines')).toHaveText('$650,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-balance-difference')).toHaveText('$0.00');

  // The row is expandable both ways; collapsing removes the detail panel.
  await page.getByTestId('technical-account-expand').click();
  await expect(panel).toHaveCount(0);
});

test('adds a line to a DRAFT statement and recomputes the reconciliation', async ({ page }) => {
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    balance: '650000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  state.lines['ta-30'] = [
    accountLine({ id: 'line-1', lineType: 'PREMIUM', amount: '1000000.0000', sequence: 1 }),
    accountLine({
      id: 'line-2',
      lineType: 'COMMISSION',
      reference: 'COMM-2026-001',
      description: 'Q1 ceding commission',
      amount: '100000.0000',
      sequence: 2
    })
  ];
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expandLines(page);
  const panel = page.getByTestId('technical-account-lines-panel');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Not reconciled');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveClass(/red/);
  await expect(panel.getByTestId('technical-account-line-form')).toBeVisible();

  await page.getByLabel('Line type').selectOption('PAID_LOSS');
  await page.getByLabel('Reference').fill('LOSS-2026-001');
  await page.getByLabel('Description').fill('Q1 paid loss');
  await page.getByLabel('Amount').fill('250000');
  await page.getByRole('button', { name: 'Add line' }).click();

  await expect.poll(() => state.linePosts.length).toBe(1);
  expect(state.linePosts[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/lines`,
    body: {
      lineType: 'PAID_LOSS',
      reference: 'LOSS-2026-001',
      description: 'Q1 paid loss',
      amount: '250000.0000'
    },
    tenant: TENANT,
    accountId: 'ta-30'
  });

  await expect(panel.getByTestId('technical-account-line-row')).toHaveCount(3);
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Reconciled');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveClass(/green/);
  await expect(panel.getByTestId('technical-account-line-message')).toHaveText(
    'Paid loss line recorded.'
  );
  await expect(page.getByLabel('Amount')).toHaveValue('');
  await expect(page.getByLabel('Line type')).toHaveValue('PREMIUM');
});

test('offers every line type, labels it, and rolls it into its bucket', async ({ page }) => {
  const amounts = {
    PREMIUM: '100000.0000',
    COMMISSION: '40000.0000',
    BROKERAGE: '10000.0000',
    PAID_LOSS: '60000.0000',
    OUTSTANDING_LOSS: '30000.0000',
    IBNR: '20000.0000',
    ALAE: '10000.0000',
    REINSTATEMENT: '5000.0000',
    CASH_CALL: '5000.0000',
    FUNDS_WITHHELD: '20000.0000',
    TAX: '15000.0000',
    ADJUSTMENT: '10000.0000',
    OTHER: '5000.0000'
  };
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '100000.0000',
    cededLosses: '130000.0000',
    commission: '50000.0000',
    otherCharges: '50000.0000',
    balance: '-30000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  state.lines['ta-30'] = LINE_TYPE_OPTIONS.map(([lineType], index) => accountLine({
    id: `line-${index + 1}`,
    lineType,
    reference: `REF-2026-${String(index + 1).padStart(3, '0')}`,
    description: `${lineType} line`,
    amount: amounts[lineType],
    sequence: index + 1
  }));
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expandLines(page);
  const panel = page.getByTestId('technical-account-lines-panel');

  // The add form exposes the whole line-type domain with human labels.
  const options = await page.getByLabel('Line type').locator('option').evaluateAll(
    (nodes) => nodes.map((node) => ({ value: node.value, label: node.textContent.trim() }))
  );
  expect(options).toEqual(
    LINE_TYPE_OPTIONS.map(([value, label]) => ({ value, label }))
  );

  const rows = panel.getByTestId('technical-account-line-row');
  await expect(rows).toHaveCount(LINE_TYPE_OPTIONS.length);
  await expect(panel.getByTestId('technical-account-line-type-count')).toHaveText('13 types');
  await expect(panel.getByTestId('technical-account-line-bucket-count')).toHaveText('4 buckets');

  // Every detail type shows its human label and its bucket in the totals table.
  for (const [index, [type, label, bucket]] of LINE_TYPE_OPTIONS.entries()) {
    await expect(rows.nth(index).getByTestId('technical-account-line-type')).toHaveText(label);
    const total = panel.getByTestId(`technical-account-line-total-${type}`);
    await expect(total).toContainText(label);
    await expect(total).toContainText(bucket);
    await expect(total).toContainText(usd(amounts[type]));
  }

  // The four bucket totals aggregate the mapped types exactly.
  const bucketTotals = [
    ['premium', 1, '100000.0000'],
    ['loss', 6, '130000.0000'],
    ['commission', 2, '50000.0000'],
    ['other', 4, '50000.0000']
  ];
  for (const [bucket, count, amount] of bucketTotals) {
    const row = panel.getByTestId(`technical-account-line-bucket-${bucket}`);
    await expect(row.getByTestId(`technical-account-line-bucket-${bucket}-count`))
      .toHaveText(String(count));
    await expect(row.getByTestId(`technical-account-line-bucket-${bucket}-amount`))
      .toHaveText(usd(amount));
  }

  // Header reconciliation still compares each bucket's lines with its header
  // component, plus the derived balance.
  const components = [
    ['premium', '100000.0000'],
    ['losses', '130000.0000'],
    ['commission', '50000.0000'],
    ['otherCharges', '50000.0000']
  ];
  for (const [component, amount] of components) {
    await expect(panel.getByTestId(`technical-account-reconciliation-${component}-lines`))
      .toHaveText(usd(amount));
  }
  await expect(panel.getByTestId('technical-account-reconciliation-balance-lines'))
    .toHaveText(usd('-30000'));
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Reconciled');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveClass(/green/);
});

test('posts each add-line option with its amount as a 4-dp decimal string', async ({ page }) => {
  test.setTimeout(90000);
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '0.0000',
    cededLosses: '0.0000',
    commission: '0.0000',
    otherCharges: '0.0000',
    balance: '0.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expandLines(page);
  const panel = page.getByTestId('technical-account-lines-panel');

  for (const [index, [type, label]] of LINE_TYPE_OPTIONS.entries()) {
    await page.getByLabel('Line type').selectOption(type);
    await page.getByLabel('Amount').fill('1000.5');
    await page.getByRole('button', { name: 'Add line' }).click();

    await expect.poll(() => state.linePosts.length).toBe(index + 1);
    expect(state.linePosts[index]).toEqual({
      path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/lines`,
      body: { lineType: type, amount: '1000.5000' },
      tenant: TENANT,
      accountId: 'ta-30'
    });

    // The form resets for the next line and the created line renders by label.
    await expect(page.getByLabel('Amount')).toHaveValue('');
    await expect(page.getByLabel('Line type')).toHaveValue('PREMIUM');
    const rows = panel.getByTestId('technical-account-line-row');
    await expect(rows).toHaveCount(index + 1);
    await expect(rows.nth(index).getByTestId('technical-account-line-type')).toHaveText(label);
  }
});

test('deletes a line only after confirmation and updates the totals', async ({ page }) => {
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    balance: '650000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  state.lines['ta-30'] = [
    accountLine({ id: 'line-1', lineType: 'PREMIUM', amount: '1000000.0000', sequence: 1 }),
    accountLine({
      id: 'line-2',
      lineType: 'PAID_LOSS',
      reference: 'LOSS-2026-001',
      description: 'Q1 paid loss',
      amount: '250000.0000',
      sequence: 2
    }),
    accountLine({
      id: 'line-3',
      lineType: 'COMMISSION',
      reference: 'COMM-2026-001',
      description: 'Q1 ceding commission',
      amount: '100000.0000',
      sequence: 3
    })
  ];
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

  await openTechnicalAccounts(page);
  await expandLines(page);
  const panel = page.getByTestId('technical-account-lines-panel');
  const lineRows = panel.getByTestId('technical-account-line-row');
  await expect(lineRows).toHaveCount(3);
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Reconciled');

  // Dismissing the confirmation sends nothing.
  await lineRows.nth(0).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(200);
  expect(state.lineDeletes).toHaveLength(0);
  await expect(lineRows).toHaveCount(3);
  dialogs.length = 0;

  acceptDialogs = true;
  await lineRows.nth(0).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => state.lineDeletes.length).toBe(1);
  expect(state.lineDeletes[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/lines/line-1`,
    tenant: TENANT,
    accountId: 'ta-30',
    lineId: 'line-1'
  });
  expect(dialogs[0]).toContain('Delete the Premium line BORD-2026-001');
  await expect(lineRows).toHaveCount(2);
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Not reconciled');
  await expect(panel.getByTestId('technical-account-line-message')).toHaveText('Premium line deleted.');
});

test('an issued statement exposes its lines as immutable', async ({ page }) => {
  const issued = account({
    accountId: 'ta-20',
    accountNumber: 'TA-2026-00020',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    cededPremium: '2000000.0000',
    cededLosses: '500000.0000',
    commission: '200000.0000',
    balance: '1300000.0000',
    status: 'ISSUED'
  });
  const state = emptyState([issued]);
  state.lines['ta-20'] = [
    accountLine({
      id: 'line-1',
      technicalAccountId: 'ta-20',
      lineType: 'PREMIUM',
      amount: '2000000.0000',
      sequence: 1
    }),
    accountLine({
      id: 'line-2',
      technicalAccountId: 'ta-20',
      lineType: 'PAID_LOSS',
      amount: '500000.0000',
      sequence: 2
    }),
    accountLine({
      id: 'line-3',
      technicalAccountId: 'ta-20',
      lineType: 'COMMISSION',
      amount: '200000.0000',
      sequence: 3
    })
  ];
  await mockContractApi(page, state);

  await openTechnicalAccounts(page);
  await expandLines(page);
  const panel = page.getByTestId('technical-account-lines-panel');
  await expect(panel.getByTestId('technical-account-line-row')).toHaveCount(3);
  await expect(panel.getByTestId('technical-account-line-form')).toHaveCount(0);
  await expect(panel.getByTestId('technical-account-line-form-error')).toHaveCount(0);
  await expect(panel.getByTestId('technical-account-lines-readonly')).toContainText('ISSUED');
  await expect(panel.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(panel.getByText('Locked')).toHaveCount(3);
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Reconciled');
  await expect(page.getByTestId('technical-account-row').getByRole('button', { name: 'Settle' })).toBeVisible();
});

test('a line-reconciliation 409 on issue shows the detail and keeps the statement DRAFT', async ({ page }) => {
  const draft = account({
    accountId: 'ta-30',
    accountNumber: 'TA-2026-00030',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cededPremium: '1000000.0000',
    cededLosses: '250000.0000',
    commission: '100000.0000',
    balance: '650000.0000',
    status: 'DRAFT'
  });
  const state = emptyState([draft]);
  state.lines['ta-30'] = [
    accountLine({
      id: 'line-1',
      lineType: 'PREMIUM',
      reference: 'BORD-2026-001',
      description: 'Q1 premium',
      amount: '900000.0000',
      sequence: 1
    }),
    accountLine({
      id: 'line-2',
      lineType: 'PAID_LOSS',
      reference: 'LOSS-2026-001',
      description: 'Q1 paid loss',
      amount: '250000.0000',
      sequence: 2
    }),
    accountLine({
      id: 'line-3',
      lineType: 'COMMISSION',
      reference: 'COMM-2026-001',
      description: 'Q1 ceding commission',
      amount: '100000.0000',
      sequence: 3
    })
  ];
  state.statusError = {
    status: 409,
    // The public domain proxy forwards the code and message but drops the
    // expert's per-type field violations; the panel must derive the detail from
    // the lines it already loaded.
    body: {
      code: 'ACCOUNT_LINES_DO_NOT_RECONCILE',
      message: 'Technical account TA-2026-00030 line totals do not reconcile to its header amounts'
    }
  };
  await mockContractApi(page, state);

  page.on('dialog', (dialog) => dialog.accept());

  await openTechnicalAccounts(page);
  const row = page.getByTestId('technical-account-row');
  await expect(row.getByTestId('technical-account-status')).toHaveText('DRAFT');
  await row.getByRole('button', { name: 'Issue' }).click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/technical-accounts/ta-30/status`,
    body: { status: 'ISSUED' },
    tenant: TENANT,
    accountId: 'ta-30'
  });

  const detail = page.getByTestId('technical-account-lines-reconcile-error');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('ACCOUNT_LINES_DO_NOT_RECONCILE');
  await expect(detail).toContainText(
    'Technical account TA-2026-00030 line totals do not reconcile to its header amounts'
  );
  // The detail is derived from the loaded lines when the proxy omits the
  // expert's field violations.
  await expect(detail).toContainText(
    'Ceded premium header $1,000,000.00 vs lines $900,000.00 (difference -$100,000.00)'
  );
  await expect(detail).toContainText(
    'Balance header $650,000.00 vs lines $550,000.00 (difference -$100,000.00)'
  );
  await expect(page.getByTestId('technical-account-lines-reconcile-details').locator('li')).toHaveCount(2);

  // The failed issue leaves the server status untouched: the row is still DRAFT
  // and the issue action remains available for a corrected statement.
  await expect(row.getByTestId('technical-account-status')).toHaveText('DRAFT');
  await expect(row.getByRole('button', { name: 'Issue' })).toBeVisible();
  await expect(page.getByTestId('technical-account-message')).toHaveCount(0);

  const panel = page.getByTestId('technical-account-lines-panel');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveText('Not reconciled');
  await expect(panel.getByTestId('technical-account-lines-reconciled')).toHaveClass(/red/);
  await expect(panel.getByTestId('technical-account-reconciliation-premium-difference')).toHaveText('-$100,000.00');
  await expect(panel.getByTestId('technical-account-reconciliation-balance-difference')).toHaveText('-$100,000.00');
  await expect(panel.locator('table[aria-label="Statement lines"]')).toBeVisible();
});
