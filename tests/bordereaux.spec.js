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

function bordereau(overrides = {}) {
  return {
    bordereauId: 'brd-10',
    tenantId: TENANT,
    contractId: CONTRACT_ID,
    bordereauNumber: 'BRD-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    receivedDate: '2026-04-02',
    currency: 'USD',
    premiumAmount: '1000000.0000',
    lossAmount: '250000.0000',
    commissionAmount: '100000.0000',
    otherChargesAmount: '0.0000',
    lineCount: 3,
    notes: null,
    status: 'RECEIVED',
    technicalAccountId: null,
    createdAt: '2026-04-02T09:30:00Z',
    ...overrides
  };
}

function emptyState(rows = []) {
  return {
    rows,
    accounts: [],
    listRequests: [],
    posts: [],
    patches: [],
    listError: null,
    createError: null,
    statusError: null
  };
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks every contract endpoint the workbench touches on selection, plus the
 * bordereau collection and status routes. Mutating handlers update the in-memory
 * rows so the panel's reload sees the new state.
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
    if (method === 'GET' && path === `${base}/technical-accounts`) {
      await json(route, 200, state.accounts);
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

    if (path === `${base}/bordereaux`) {
      if (method === 'GET') {
        state.listRequests.push({ path, tenant });
        if (state.listError) {
          await json(route, state.listError.status, state.listError.body);
          return;
        }
        await json(route, 200, state.rows);
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
          bordereauId: `brd-${state.rows.length + 1}`,
          tenantId: TENANT,
          contractId: CONTRACT_ID,
          bordereauNumber: 'BRD-2026-00077',
          ...body,
          status: 'RECEIVED',
          technicalAccountId: null,
          createdAt: '2026-04-02T09:30:00Z'
        };
        state.rows.push(created);
        await json(route, 201, created);
        return;
      }
    }

    const statusMatch = path.match(/^\/api\/v1\/contracts\/([^/]+)\/bordereaux\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch && statusMatch[1] === CONTRACT_ID) {
      const body = request.postDataJSON();
      state.patches.push({ path, body, tenant, bordereauId: statusMatch[2] });
      if (state.statusError) {
        if (state.statusError.mutate) {
          state.statusError.mutate(state);
        }
        await json(route, state.statusError.status, state.statusError.body);
        return;
      }
      const row = state.rows.find((candidate) => candidate.bordereauId === statusMatch[2]);
      if (row) {
        row.status = body.status;
        if (body.status === 'PROCESSED') {
          row.technicalAccountId = 'ta-55';
          state.accounts = state.accounts
            .filter((account) => account.id !== 'ta-55')
            .concat({ id: 'ta-55', accountNumber: 'TA-2026-00055' });
        }
        if (body.notes) {
          row.notes = body.notes;
        }
      }
      await json(route, 200, row || {});
      return;
    }

    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

async function openBordereaux(page) {
  await page.goto(`/?record=${CONTRACT_ID}`);
  await expect(page.getByRole('heading', { name: contract.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Bordereaux', exact: true }).click();
  await expect(page.getByTestId('bordereaux-panel')).toBeVisible();
}

test('lists bordereaux newest period first with the submission totals and linked account', async ({ page }) => {
  const firstQuarter = bordereau({
    bordereauId: 'brd-10',
    bordereauNumber: 'BRD-2026-00010',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    receivedDate: '2026-04-02',
    premiumAmount: '1000000.0000',
    lossAmount: '250000.0000',
    commissionAmount: '100000.0000',
    lineCount: 3,
    status: 'RECEIVED'
  });
  const secondQuarter = bordereau({
    bordereauId: 'brd-20',
    bordereauNumber: 'BRD-2026-00020',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    receivedDate: '2026-07-02',
    premiumAmount: '2000000.0000',
    lossAmount: '500000.0000',
    commissionAmount: '200000.0000',
    lineCount: 4,
    status: 'PROCESSED',
    technicalAccountId: 'ta-20'
  });
  const fourthQuarter = bordereau({
    bordereauId: 'brd-30',
    bordereauNumber: 'BRD-2025-00030',
    periodStart: '2025-10-01',
    periodEnd: '2025-12-31',
    receivedDate: '2026-01-05',
    premiumAmount: '500000.0000',
    lossAmount: '100000.0000',
    commissionAmount: '50000.0000',
    lineCount: 2,
    status: 'FAILED'
  });
  const state = emptyState([firstQuarter, secondQuarter, fourthQuarter]);
  state.accounts = [{ id: 'ta-20', accountNumber: 'TA-2026-00020' }];
  await mockContractApi(page, state);

  await openBordereaux(page);
  await expect.poll(() => state.listRequests.length).toBe(1);
  expect(state.listRequests).toEqual([
    { path: `/api/v1/contracts/${CONTRACT_ID}/bordereaux`, tenant: TENANT }
  ]);

  const rows = page.getByTestId('bordereau-row');
  await expect(rows).toHaveCount(3);

  // The service returns insertion order; the panel must show the newest period first.
  await expect(rows.nth(0).getByTestId('bordereau-number')).toHaveText('BRD-2026-00020');
  await expect(rows.nth(0).getByTestId('bordereau-period')).toHaveText('2026-04-01 → 2026-06-30');
  await expect(rows.nth(0).getByTestId('bordereau-received')).toHaveText('2026-07-02');
  await expect(rows.nth(0).getByTestId('bordereau-line-count')).toHaveText('4');
  await expect(rows.nth(0).getByTestId('bordereau-premium')).toHaveText('$2,000,000.00');
  await expect(rows.nth(0).getByTestId('bordereau-loss')).toHaveText('$500,000.00');
  await expect(rows.nth(0).getByTestId('bordereau-commission')).toHaveText('$200,000.00');
  await expect(rows.nth(0).getByTestId('bordereau-status')).toHaveText('PROCESSED');
  await expect(rows.nth(0).getByTestId('bordereau-status')).toHaveClass(/green/);
  await expect(rows.nth(0).getByTestId('bordereau-account-link')).toHaveText('TA-2026-00020');
  await expect(rows.nth(0).getByTestId('bordereau-action')).toHaveText('—');

  await expect(rows.nth(1).getByTestId('bordereau-number')).toHaveText('BRD-2026-00010');
  await expect(rows.nth(1).getByTestId('bordereau-status')).toHaveText('RECEIVED');
  await expect(rows.nth(1).getByTestId('bordereau-status')).toHaveClass(/amber/);
  await expect(rows.nth(1).getByTestId('bordereau-technical-account')).toHaveText('Not yet processed');
  await expect(rows.nth(1).getByRole('button', { name: 'Process' })).toBeVisible();
  await expect(rows.nth(1).getByRole('button', { name: 'Fail' })).toBeVisible();

  await expect(rows.nth(2).getByTestId('bordereau-number')).toHaveText('BRD-2025-00030');
  await expect(rows.nth(2).getByTestId('bordereau-status')).toHaveText('FAILED');
  await expect(rows.nth(2).getByTestId('bordereau-status')).toHaveClass(/red/);
  await expect(rows.nth(2).getByTestId('bordereau-action')).toHaveText('—');

  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('1');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('1');
  await expect(page.getByTestId('bordereau-summary-premium')).toHaveText('$3,500,000.00');
  await expect(page.getByTestId('bordereau-summary-loss')).toHaveText('$850,000.00');
  await expect(page.getByTestId('bordereau-summary-line-count')).toHaveText('9');
  await expect(page.getByTestId('bordereau-count')).toHaveText('3 bordereaux');

  const note = page.getByTestId('bordereau-context-note');
  await expect(note).toContainText('cedent\'s period submission');
  await expect(note).toContainText('Processing it creates the period\'s technical account');
  await expect(note).toContainText('the contract remains the source of its terms');
  await expect(note).toContainText('FS-RI');
  await expect(note).toContainText('SAP');
});

test('records a submission with its period, received date, amounts, lines, and notes', async ({ page }) => {
  const state = emptyState();
  await mockContractApi(page, state);

  await openBordereaux(page);
  await expect(page.getByTestId('bordereau-empty')).toHaveText(
    'No bordereaux yet for this contract.'
  );

  // An inverted period is rejected locally and never posted.
  await page.getByLabel('Period start').fill('2026-04-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Received date').fill('2026-04-02');
  await page.getByRole('button', { name: 'Record bordereau' }).click();
  await expect(page.getByTestId('bordereau-error')).toContainText(
    'Period end must be after period start.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Received date').fill('2026-04-02');
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('Premium').fill('1000000');
  await page.getByLabel('Loss').fill('250000');
  await page.getByLabel('Commission').fill('100000');
  await page.getByLabel('Other charges').fill('5000');
  await page.getByLabel('Line count').fill('12');
  await page.getByLabel('Notes').fill('Q1 cedent submission');
  await page.getByRole('button', { name: 'Record bordereau' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].path).toBe(`/api/v1/contracts/${CONTRACT_ID}/bordereaux`);
  expect(state.posts[0].tenant).toBe(TENANT);
  expect(state.posts[0].body).toEqual({
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    receivedDate: '2026-04-02',
    currency: 'USD',
    premiumAmount: '1000000.0000',
    lossAmount: '250000.0000',
    commissionAmount: '100000.0000',
    otherChargesAmount: '5000.0000',
    lineCount: 12,
    notes: 'Q1 cedent submission'
  });

  await expect(page.getByTestId('bordereau-message')).toHaveText('Bordereau BRD-2026-00077 recorded.');
  const row = page.getByTestId('bordereau-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('bordereau-number')).toHaveText('BRD-2026-00077');
  await expect(row.getByTestId('bordereau-period')).toHaveText('2026-01-01 → 2026-03-31');
  await expect(row.getByTestId('bordereau-received')).toHaveText('2026-04-02');
  await expect(row.getByTestId('bordereau-line-count')).toHaveText('12');
  await expect(row.getByTestId('bordereau-premium')).toHaveText('$1,000,000.00');
  await expect(row.getByTestId('bordereau-loss')).toHaveText('$250,000.00');
  await expect(row.getByTestId('bordereau-status')).toHaveText('RECEIVED');
  await expect(row.getByTestId('bordereau-technical-account')).toHaveText('Not yet processed');

  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('1');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-premium')).toHaveText('$1,000,000.00');
  await expect(page.getByTestId('bordereau-summary-loss')).toHaveText('$250,000.00');
  await expect(page.getByTestId('bordereau-summary-line-count')).toHaveText('12');

  // The form is ready for the next submission.
  await expect(page.getByLabel('Period start')).toHaveValue('');
  await expect(page.getByLabel('Received date')).toHaveValue('');
  await expect(page.getByLabel('Premium')).toHaveValue('');
  await expect(page.getByLabel('Notes')).toHaveValue('');
});

test('processes a received submission into a linked technical account after confirmation', async ({ page }) => {
  const state = emptyState([bordereau()]);
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

  await openBordereaux(page);
  const row = page.getByTestId('bordereau-row');
  await expect(row.getByTestId('bordereau-status')).toHaveText('RECEIVED');
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('1');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('0');

  // Dismissing the confirmation sends nothing.
  await row.getByRole('button', { name: 'Process' }).click();
  await page.waitForTimeout(200);
  expect(state.patches).toHaveLength(0);
  await expect(row.getByTestId('bordereau-status')).toHaveText('RECEIVED');
  dialogs.length = 0;

  acceptDialogs = true;
  await row.getByRole('button', { name: 'Process' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/bordereaux/brd-10/status`,
    body: { status: 'PROCESSED' },
    tenant: TENANT,
    bordereauId: 'brd-10'
  });

  await expect(row.getByTestId('bordereau-status')).toHaveText('PROCESSED');
  await expect(row.getByTestId('bordereau-status')).toHaveClass(/green/);
  await expect(row.getByTestId('bordereau-account-link')).toHaveText('TA-2026-00055');
  await expect(row.getByTestId('bordereau-action')).toHaveText('—');
  await expect(page.getByTestId('bordereau-message')).toContainText(
    'Technical account TA-2026-00055 created.'
  );
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('1');

  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('Process bordereau BRD-2026-00010 for 2026-01-01 → 2026-03-31');
  expect(dialogs[0]).toContain('creates a technical account');
  expect(dialogs[0]).toContain('The contract remains the source of its terms.');

  // The linked account opens the technical-accounts tab for the same contract.
  await row.getByTestId('bordereau-account-link').click();
  await expect(page.getByTestId('technical-accounts-panel')).toBeVisible();
});

test('fails a received submission with an optional note and leaves terminal rows without actions', async ({ page }) => {
  const state = emptyState([
    bordereau({ bordereauId: 'brd-10', bordereauNumber: 'BRD-2026-00010' }),
    bordereau({
      bordereauId: 'brd-11',
      bordereauNumber: 'BRD-2025-00011',
      periodStart: '2025-10-01',
      periodEnd: '2025-12-31',
      receivedDate: '2026-01-05'
    })
  ]);
  await mockContractApi(page, state);

  await openBordereaux(page);
  const rows = page.getByTestId('bordereau-row');
  await expect(rows).toHaveCount(2);

  // Cancelling the fail form sends nothing.
  await rows.nth(0).getByTestId('bordereau-fail').click();
  await expect(page.getByTestId('bordereau-fail-form')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('bordereau-fail-form')).toHaveCount(0);
  expect(state.patches).toHaveLength(0);

  // Fail without a note: the optional note key is omitted.
  await rows.nth(0).getByTestId('bordereau-fail').click();
  await page.getByRole('button', { name: 'Confirm fail' }).click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/bordereaux/brd-10/status`,
    body: { status: 'FAILED' },
    tenant: TENANT,
    bordereauId: 'brd-10'
  });
  await expect(rows.nth(0).getByTestId('bordereau-status')).toHaveText('FAILED');
  await expect(rows.nth(0).getByTestId('bordereau-status')).toHaveClass(/red/);
  await expect(rows.nth(0).getByTestId('bordereau-action')).toHaveText('—');
  await expect(page.getByTestId('bordereau-message')).toHaveText('Bordereau BRD-2026-00010 failed.');
  await expect(page.getByTestId('bordereau-fail-form')).toHaveCount(0);
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('1');

  // Fail with a note: the note travels with the status command.
  await rows.nth(1).getByTestId('bordereau-fail').click();
  await page.getByLabel('Failure note (optional)').fill('Period does not match the treaty year');
  await page.getByRole('button', { name: 'Confirm fail' }).click();
  await expect.poll(() => state.patches.length).toBe(2);
  expect(state.patches[1]).toEqual({
    path: `/api/v1/contracts/${CONTRACT_ID}/bordereaux/brd-11/status`,
    body: { status: 'FAILED', notes: 'Period does not match the treaty year' },
    tenant: TENANT,
    bordereauId: 'brd-11'
  });
  await expect(rows.nth(1).getByTestId('bordereau-status')).toHaveText('FAILED');
  await expect(rows.nth(1).getByTestId('bordereau-action')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('0');
});

test('shows the empty state, zero counts, and the submission context note', async ({ page }) => {
  await mockContractApi(page, emptyState());

  await openBordereaux(page);
  await expect(page.getByTestId('bordereau-empty')).toBeVisible();
  await expect(page.getByTestId('bordereau-loading')).toHaveCount(0);
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-premium')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-loss')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-line-count')).toHaveText('—');
  await expect(page.getByTestId('bordereau-count')).toHaveText('0 bordereaux');
  await expect(page.getByTestId('bordereau-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record bordereau' })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
  await expect(page.getByTestId('bordereau-context-note')).toContainText(
    'A bordereau is the cedent\'s period submission'
  );
});

test('contains a bordereau load failure inside the tab', async ({ page }) => {
  const state = emptyState();
  state.listError = {
    status: 503,
    body: {
      code: 'BORDEREAU_SERVICE_UNAVAILABLE',
      message: 'Bordereau store unavailable'
    }
  };
  await mockContractApi(page, state);

  await openBordereaux(page);
  const error = page.getByTestId('bordereau-error');
  await expect(error).toContainText('Bordereaux could not be loaded');
  await expect(error).toContainText('BORDEREAU_SERVICE_UNAVAILABLE: Bordereau store unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(page.getByTestId('bordereau-empty')).toHaveCount(0);
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-premium')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-loss')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-line-count')).toHaveText('—');
  await expect(page.getByTestId('bordereau-count')).toHaveText('—');
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');

  // The record remains usable after the contained failure.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contract details' })).toBeVisible();
});

test('shows a 409 when a duplicate submission period is rejected, keeping the form', async ({ page }) => {
  const state = emptyState();
  state.createError = {
    status: 409,
    body: {
      code: 'DUPLICATE_BORDEREAU_PERIOD',
      message: 'A bordereau already exists for contract period 2026-01-01 to 2026-03-31'
    }
  };
  await mockContractApi(page, state);

  await openBordereaux(page);
  await page.getByLabel('Period start').fill('2026-01-01');
  await page.getByLabel('Period end').fill('2026-03-31');
  await page.getByLabel('Received date').fill('2026-04-02');
  await page.getByLabel('Premium').fill('1000000');
  await page.getByRole('button', { name: 'Record bordereau' }).click();

  await expect.poll(() => state.posts.length).toBe(1);
  const error = page.getByTestId('bordereau-error');
  await expect(error).toContainText('DUPLICATE_BORDEREAU_PERIOD');
  await expect(error).toContainText(
    'A bordereau already exists for contract period 2026-01-01 to 2026-03-31'
  );
  await expect(page.getByLabel('Period start')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('Premium')).toHaveValue('1000000');
  await expect(page.getByTestId('bordereau-empty')).toBeVisible();
  await expect(page.getByTestId('bordereau-message')).toHaveCount(0);
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('0');
});

test('contains a 409 when processing loses a race and reloads the terminal row', async ({ page }) => {
  const state = emptyState([bordereau()]);
  state.statusError = {
    status: 409,
    body: {
      code: 'INVALID_BORDEREAU_STATUS',
      message: 'Bordereau BRD-2026-00010 is no longer RECEIVED'
    },
    mutate: (current) => {
      const row = current.rows[0];
      row.status = 'PROCESSED';
      row.technicalAccountId = 'ta-55';
      current.accounts = [{ id: 'ta-55', accountNumber: 'TA-2026-00055' }];
    }
  };
  await mockContractApi(page, state);

  page.on('dialog', (dialog) => dialog.accept());
  await openBordereaux(page);
  const row = page.getByTestId('bordereau-row');
  await row.getByRole('button', { name: 'Process' }).click();

  await expect.poll(() => state.patches.length).toBe(1);
  await expect(page.getByTestId('bordereau-error')).toContainText(
    'INVALID_BORDEREAU_STATUS: Bordereau BRD-2026-00010 is no longer RECEIVED'
  );
  await expect(page.getByTestId('bordereau-message')).toHaveCount(0);
  // The conflict reload reflects the row another user already processed.
  await expect(row.getByTestId('bordereau-status')).toHaveText('PROCESSED');
  await expect(row.getByTestId('bordereau-account-link')).toHaveText('TA-2026-00055');
  await expect(row.getByTestId('bordereau-action')).toHaveText('—');
  await expect(page.getByTestId('bordereau-summary-received')).toHaveText('0');
  await expect(page.getByTestId('bordereau-summary-processed')).toHaveText('1');
});
