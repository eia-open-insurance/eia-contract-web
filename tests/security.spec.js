import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const PROVIDER_ID = '55555555-5555-7555-8555-555555555555';

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

function security(overrides = {}) {
  return {
    id: 'sec-10',
    securityType: 'LETTER_OF_CREDIT',
    requiredAmount: '5000000.0000',
    heldAmount: '5000000.0000',
    currency: 'USD',
    providerPartyId: PROVIDER_ID,
    expiryDate: '2027-12-31',
    approvalRef: 'LOC-2026-0001',
    status: 'ACTIVE',
    createdAt: '2026-01-02T09:30:00Z',
    ...overrides
  };
}

function emptyState(securities = []) {
  return {
    securities,
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
 * security collection and status routes. Mutating handlers update the in-memory
 * records so the panel's reload sees the new state.
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

    if (path === `${base}/security`) {
      if (method === 'GET') {
        state.listRequests.push({ path, tenant });
        if (state.listDelay) {
          await new Promise((resolve) => setTimeout(resolve, state.listDelay));
        }
        if (state.listError) {
          await json(route, state.listError.status, state.listError.body);
          return;
        }
        await json(route, 200, state.securities);
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
          id: `sec-${state.securities.length + 1}`,
          securityType: body.securityType,
          requiredAmount: body.requiredAmount,
          heldAmount: body.heldAmount || '0.0000',
          currency: body.currency,
          providerPartyId: body.providerPartyId || null,
          expiryDate: body.expiryDate || null,
          approvalRef: body.approvalRef || null,
          status: 'ACTIVE',
          createdAt: '2026-04-01T09:30:00Z'
        };
        state.securities.unshift(created);
        await json(route, 201, created);
        return;
      }
    }

    const statusMatch = path.match(/^\/api\/v1\/contracts\/([^/]+)\/security\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch && statusMatch[1] === CONTRACT_ID) {
      const body = request.postDataJSON();
      state.patches.push({ path, body, tenant, securityId: statusMatch[2] });
      if (state.statusError) {
        await json(route, state.statusError.status, state.statusError.body);
        return;
      }
      const row = state.securities.find((candidate) => candidate.id === statusMatch[2]);
      if (row) {
        row.status = body.status;
      }
      await json(route, 200, row || {});
      return;
    }

    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openSecurity(page) {
  await page.goto(`/?record=${CONTRACT_ID}`);
  await expect(page.getByRole('heading', { name: contract.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.getByTestId('security-panel')).toBeVisible();
}

test('lists security with totals, counts, all columns, and lifecycle actions', async ({ page }) => {
  const activeLoc = security({
    id: 'sec-10',
    securityType: 'LETTER_OF_CREDIT',
    requiredAmount: '5000000.0000',
    heldAmount: '5000000.0000',
    providerPartyId: PROVIDER_ID,
    expiryDate: '2027-12-31',
    approvalRef: 'LOC-2026-0001',
    status: 'ACTIVE'
  });
  const activeTrust = security({
    id: 'sec-20',
    securityType: 'TRUST_FUND',
    requiredAmount: '2000000.0000',
    heldAmount: '1500000.0000',
    providerPartyId: '66666666-6666-7666-8666-666666666666',
    expiryDate: '2026-12-31',
    approvalRef: '',
    status: 'ACTIVE'
  });
  const releasedGuarantee = security({
    id: 'sec-30',
    securityType: 'BANK_GUARANTEE',
    requiredAmount: '1000000.0000',
    heldAmount: '1000000.0000',
    providerPartyId: null,
    expiryDate: '2026-09-30',
    approvalRef: 'BG-2026-0003',
    status: 'RELEASED'
  });
  const expiredWithheld = security({
    id: 'sec-40',
    securityType: 'FUNDS_WITHHELD',
    requiredAmount: '750000.0000',
    heldAmount: '250000.0000',
    providerPartyId: null,
    expiryDate: '2025-12-31',
    approvalRef: '',
    status: 'EXPIRED'
  });
  const state = emptyState([activeLoc, activeTrust, releasedGuarantee, expiredWithheld]);
  state.listDelay = 1000;
  await mockContractApi(page, state);

  await openSecurity(page);

  // The tab sits directly after Terms and loading stays in the panel.
  const tabNames = await page.locator('.eia-tabs .eia-tab').allTextContents();
  expect(tabNames.indexOf('Security')).toBe(tabNames.indexOf('Terms') + 1);
  await expect(page.getByTestId('security-loading')).toBeVisible();
  await expect(page.getByTestId('security-summary-required')).toHaveText('…');
  await expect(page.getByTestId('security-summary-active')).toHaveText('…');

  await expect.poll(() => state.listRequests.length).toBe(1);
  expect(state.listRequests).toEqual([
    { path: `/api/v1/contracts/${CONTRACT_ID}/security`, tenant: TENANT }
  ]);

  const rows = page.getByTestId('security-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('security-loading')).toHaveCount(0);
  await expect(page.getByTestId('security-count')).toHaveText('4 security records');

  await expect(rows.nth(0).getByTestId('security-type')).toHaveText('LETTER_OF_CREDIT');
  await expect(rows.nth(0).getByTestId('security-required')).toHaveText('$5,000,000.00');
  await expect(rows.nth(0).getByTestId('security-held')).toHaveText('$5,000,000.00');
  await expect(rows.nth(0).getByTestId('security-currency')).toHaveText('USD');
  await expect(rows.nth(0).getByTestId('security-provider')).toHaveText('55555555');
  await expect(rows.nth(0).getByTestId('security-expiry')).toHaveText('2027-12-31');
  await expect(rows.nth(0).getByTestId('security-approval-ref')).toHaveText('LOC-2026-0001');
  await expect(rows.nth(0).getByTestId('security-status')).toHaveText('ACTIVE');
  await expect(rows.nth(0).getByTestId('security-status')).toHaveClass(/green/);
  await expect(rows.nth(0).getByRole('button', { name: 'Release' })).toBeVisible();
  await expect(rows.nth(0).getByRole('button', { name: 'Expire' })).toBeVisible();

  await expect(rows.nth(1).getByTestId('security-type')).toHaveText('TRUST_FUND');
  await expect(rows.nth(1).getByTestId('security-required')).toHaveText('$2,000,000.00');
  await expect(rows.nth(1).getByTestId('security-held')).toHaveText('$1,500,000.00');
  await expect(rows.nth(1).getByTestId('security-provider')).toHaveText('66666666');
  await expect(rows.nth(1).getByTestId('security-approval-ref')).toHaveText('—');
  await expect(rows.nth(1).getByTestId('security-status')).toHaveText('ACTIVE');

  await expect(rows.nth(2).getByTestId('security-status')).toHaveText('RELEASED');
  await expect(rows.nth(2).getByTestId('security-status')).toHaveClass(/blue/);
  await expect(rows.nth(2).getByTestId('security-provider')).toHaveText('—');
  await expect(rows.nth(2).getByTestId('security-action')).toHaveText('—');
  await expect(rows.nth(2).getByRole('button', { name: 'Release' })).toHaveCount(0);
  await expect(rows.nth(2).getByRole('button', { name: 'Expire' })).toHaveCount(0);

  await expect(rows.nth(3).getByTestId('security-status')).toHaveText('EXPIRED');
  await expect(rows.nth(3).getByTestId('security-status')).toHaveClass(/amber/);
  await expect(rows.nth(3).getByTestId('security-action')).toHaveText('—');

  await expect(page.getByTestId('security-summary-required')).toHaveText('$8,750,000.00');
  await expect(page.getByTestId('security-summary-held')).toHaveText('$7,750,000.00');
  await expect(page.getByTestId('security-summary-outstanding')).toHaveText('$1,000,000.00');
  await expect(page.getByTestId('security-summary-active')).toHaveText('2');
  await expect(page.getByTestId('security-summary-released')).toHaveText('1');

  const note = page.getByTestId('security-context-note');
  await expect(note).toContainText('Security is collateral');
  await expect(note).toContainText('not cash');
  await expect(note).toContainText('not a Payment');
  await expect(note).toContainText('does not create a Payment');
  await expect(note).toContainText('Payment and FS-RI own execution');
});

test('creates security with the collateral fields and posts the exact payload', async ({ page }) => {
  const state = emptyState();
  await mockContractApi(page, state);

  await openSecurity(page);
  await expect(page.getByTestId('security-empty')).toHaveText(
    'No security records yet for this contract.'
  );
  await expect(page.getByTestId('security-loading')).toHaveCount(0);

  // A zero obligation is rejected locally and never posted.
  await page.getByLabel('Required amount').fill('0');
  await page.getByRole('button', { name: 'Record security' }).click();
  await expect(page.getByTestId('security-error')).toContainText(
    'Required amount must be greater than zero.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Security type').selectOption('TRUST_FUND');
  await page.getByLabel('Required amount').fill('2500000');
  await page.getByLabel('Held amount').fill('2000000');
  await page.getByLabel('Provider party id').fill(PROVIDER_ID);
  await page.getByLabel('Expiry date').fill('2027-06-30');
  await page.getByLabel('Approval reference').fill('APR-77');
  await expect(page.getByLabel('Currency')).toHaveValue('USD');
  await page.getByRole('button', { name: 'Record security' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].path).toBe(`/api/v1/contracts/${CONTRACT_ID}/security`);
  expect(state.posts[0].tenant).toBe(TENANT);
  expect(state.posts[0].body).toEqual({
    securityType: 'TRUST_FUND',
    requiredAmount: '2500000.0000',
    heldAmount: '2000000.0000',
    currency: 'USD',
    providerPartyId: PROVIDER_ID,
    expiryDate: '2027-06-30',
    approvalRef: 'APR-77'
  });

  await expect(page.getByTestId('security-message')).toHaveText('Security recorded.');
  const row = page.getByTestId('security-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('security-type')).toHaveText('TRUST_FUND');
  await expect(row.getByTestId('security-required')).toHaveText('$2,500,000.00');
  await expect(row.getByTestId('security-held')).toHaveText('$2,000,000.00');
  await expect(row.getByTestId('security-expiry')).toHaveText('2027-06-30');
  await expect(row.getByTestId('security-approval-ref')).toHaveText('APR-77');
  await expect(row.getByTestId('security-status')).toHaveText('ACTIVE');
  await expect(row.getByRole('button', { name: 'Release' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Expire' })).toBeVisible();

  await expect(page.getByTestId('security-summary-required')).toHaveText('$2,500,000.00');
  await expect(page.getByTestId('security-summary-held')).toHaveText('$2,000,000.00');
  await expect(page.getByTestId('security-summary-outstanding')).toHaveText('$500,000.00');
  await expect(page.getByTestId('security-summary-active')).toHaveText('1');
  await expect(page.getByTestId('security-summary-released')).toHaveText('0');

  // The form is ready for the next record.
  await expect(page.getByLabel('Required amount')).toHaveValue('');
  await expect(page.getByLabel('Held amount')).toHaveValue('');
  await expect(page.getByLabel('Provider party id')).toHaveValue('');
  await expect(page.getByLabel('Approval reference')).toHaveValue('');
});

test('releases a non-terminal security record only after confirmation', async ({ page }) => {
  const state = emptyState([security({ id: 'sec-30', status: 'ACTIVE' })]);
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

  await openSecurity(page);
  const row = page.getByTestId('security-row');
  await expect(row.getByTestId('security-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('security-summary-active')).toHaveText('1');

  // Dismissing the confirmation sends nothing.
  await row.getByRole('button', { name: 'Release' }).click();
  await page.waitForTimeout(200);
  expect(state.patches).toHaveLength(0);
  await expect(row.getByTestId('security-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('security-message')).toHaveCount(0);
  dialogs.length = 0;

  acceptDialogs = true;
  await row.getByRole('button', { name: 'Release' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/security/sec-30/status`,
    body: { status: 'RELEASED' },
    tenant: TENANT,
    securityId: 'sec-30'
  });
  await expect(row.getByTestId('security-status')).toHaveText('RELEASED');
  await expect(row.getByTestId('security-status')).toHaveClass(/blue/);
  await expect(row.getByTestId('security-action')).toHaveText('—');
  await expect(row.getByRole('button', { name: 'Release' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Expire' })).toHaveCount(0);
  await expect(page.getByTestId('security-message')).toHaveText('Security released.');
  await expect(page.getByTestId('security-summary-active')).toHaveText('0');
  await expect(page.getByTestId('security-summary-released')).toHaveText('1');

  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('Release letter of credit collateral of $5,000,000.00');
  expect(dialogs[0]).toContain('does not create a Payment');
  expect(dialogs[0]).toContain('Payment and FS-RI own execution');
});

test('expires a non-terminal security record only after confirmation', async ({ page }) => {
  const state = emptyState([
    security({ id: 'sec-40', securityType: 'FUNDS_WITHHELD', status: 'ACTIVE', approvalRef: '' })
  ]);
  await mockContractApi(page, state);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });

  await openSecurity(page);
  const row = page.getByTestId('security-row');
  await expect(row.getByTestId('security-status')).toHaveText('ACTIVE');

  await row.getByRole('button', { name: 'Expire' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/security/sec-40/status`,
    body: { status: 'EXPIRED' },
    tenant: TENANT,
    securityId: 'sec-40'
  });
  await expect(row.getByTestId('security-status')).toHaveText('EXPIRED');
  await expect(row.getByTestId('security-status')).toHaveClass(/amber/);
  await expect(row.getByTestId('security-action')).toHaveText('—');
  await expect(row.getByRole('button', { name: 'Release' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Expire' })).toHaveCount(0);
  await expect(page.getByTestId('security-message')).toHaveText('Security expired.');
  await expect(page.getByTestId('security-summary-active')).toHaveText('0');
  await expect(page.getByTestId('security-summary-released')).toHaveText('0');

  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('Expire funds withheld collateral of $5,000,000.00');
  expect(dialogs[0]).toContain('does not create a Payment');
  expect(dialogs[0]).toContain('Payment and FS-RI own execution');
});

test('shows the empty state, zero counts, and the collateral context note', async ({ page }) => {
  await mockContractApi(page, emptyState());

  await openSecurity(page);
  await expect(page.getByTestId('security-empty')).toBeVisible();
  await expect(page.getByTestId('security-loading')).toHaveCount(0);
  await expect(page.getByTestId('security-summary-required')).toHaveText('—');
  await expect(page.getByTestId('security-summary-held')).toHaveText('—');
  await expect(page.getByTestId('security-summary-outstanding')).toHaveText('—');
  await expect(page.getByTestId('security-summary-active')).toHaveText('0');
  await expect(page.getByTestId('security-summary-released')).toHaveText('0');
  await expect(page.getByTestId('security-count')).toHaveText('0 security records');
  await expect(page.getByTestId('security-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record security' })).toBeVisible();
  await expect(page.getByTestId('security-context-note')).toContainText('Collateral, not cash');
  await expect(page.getByTestId('security-context-note')).toContainText('does not create a Payment');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
});

test('contains a security load failure inside the panel', async ({ page }) => {
  const state = emptyState();
  state.listError = {
    status: 503,
    body: {
      code: 'SECURITY_SERVICE_UNAVAILABLE',
      message: 'Collateral store unavailable'
    }
  };
  await mockContractApi(page, state);

  await openSecurity(page);
  const error = page.getByTestId('security-error');
  await expect(error).toContainText('Security could not be loaded');
  await expect(error).toContainText('SECURITY_SERVICE_UNAVAILABLE: Collateral store unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(page.getByTestId('security-empty')).toHaveCount(0);
  await expect(page.getByTestId('security-summary-required')).toHaveText('—');
  await expect(page.getByTestId('security-summary-held')).toHaveText('—');
  await expect(page.getByTestId('security-summary-outstanding')).toHaveText('—');
  await expect(page.getByTestId('security-summary-active')).toHaveText('—');
  await expect(page.getByTestId('security-summary-released')).toHaveText('—');
  await expect(page.getByTestId('security-count')).toHaveText('—');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');

  // The record remains usable after the contained failure.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contract details' })).toBeVisible();
});

test('shows a 409 when a status command loses the race and reloads the row', async ({ page }) => {
  const state = emptyState([security({ id: 'sec-20', status: 'ACTIVE' })]);
  state.statusError = {
    status: 409,
    body: {
      code: 'INVALID_SECURITY_STATUS',
      message: 'Security status cannot move from RELEASED to RELEASED'
    }
  };
  await mockContractApi(page, state);

  page.on('dialog', (dialog) => dialog.accept());
  await openSecurity(page);
  expect(state.listRequests).toHaveLength(1);

  await page.getByTestId('security-row').getByRole('button', { name: 'Release' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  const error = page.getByTestId('security-error');
  await expect(error).toContainText('INVALID_SECURITY_STATUS');
  await expect(error).toContainText('Security status cannot move from RELEASED to RELEASED');
  await expect(page.getByTestId('security-row').getByTestId('security-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('security-message')).toHaveCount(0);
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');

  // A conflict reloads the collection so the row reflects whatever state won.
  await expect.poll(() => state.listRequests.length).toBe(2);
  await expect(error).toContainText('INVALID_SECURITY_STATUS');
});

test('shows a 409 on create, keeping the entered collateral form', async ({ page }) => {
  const state = emptyState();
  state.createError = {
    status: 409,
    body: {
      code: 'SECURITY_CONFLICT',
      message: 'Security already recorded for this contract and provider'
    }
  };
  await mockContractApi(page, state);

  await openSecurity(page);
  await page.getByLabel('Security type').selectOption('BANK_GUARANTEE');
  await page.getByLabel('Required amount').fill('1500000');
  await page.getByLabel('Held amount').fill('1500000');
  await page.getByLabel('Provider party id').fill(PROVIDER_ID);
  await page.getByLabel('Expiry date').fill('2027-04-15');
  await page.getByLabel('Approval reference').fill('BG-2026-0009');
  await page.getByRole('button', { name: 'Record security' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  const error = page.getByTestId('security-error');
  await expect(error).toContainText('SECURITY_CONFLICT');
  await expect(error).toContainText('Security already recorded for this contract and provider');
  await expect(page.getByLabel('Security type')).toHaveValue('BANK_GUARANTEE');
  await expect(page.getByLabel('Required amount')).toHaveValue('1500000');
  await expect(page.getByLabel('Held amount')).toHaveValue('1500000');
  await expect(page.getByLabel('Approval reference')).toHaveValue('BG-2026-0009');
  await expect(page.getByTestId('security-empty')).toBeVisible();
  await expect(page.getByTestId('security-message')).toHaveCount(0);
  await expect(page.getByTestId('security-summary-required')).toHaveText('—');
  await expect(page.getByTestId('security-summary-active')).toHaveText('0');
});
