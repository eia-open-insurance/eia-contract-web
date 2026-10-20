import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CEDENT_ID = '33333333-3333-7333-8333-333333333333';
const REINSURER_ID = '44444444-4444-7444-8444-444444444444';

const CONTRACT_A = {
  id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: CEDENT_ID,
  reinsurerPartyId: REINSURER_ID,
  cedentDisplayName: 'Meridian Specialty',
  reinsurerDisplayName: 'Atlas Re',
  status: 'PLACED',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 2
};

const CONTRACT_B = {
  id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  tenantId: TENANT,
  contractNumber: 'QS-2026-00042',
  contractType: 'QUOTA_SHARE',
  cedentPartyId: '55555555-5555-7555-8555-555555555555',
  reinsurerPartyId: '66666666-6666-7666-8666-666666666666',
  cedentDisplayName: 'Northwind Mutual',
  reinsurerDisplayName: 'Beacon Re',
  status: 'BOUND',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 1
};

const PARTIES = {
  [CEDENT_ID]: {
    id: CEDENT_ID,
    type: 'PARTY',
    label: 'P-1001',
    secondary: 'Meridian Specialty · CEDENT',
    status: 'ACTIVE',
    href: `/party?record=${CEDENT_ID}`
  },
  [REINSURER_ID]: {
    id: REINSURER_ID,
    type: 'PARTY',
    label: 'P-2002',
    secondary: 'Atlas Re · REINSURER',
    status: 'ACTIVE',
    href: `/party?record=${REINSURER_ID}`
  }
};

const PARTY_DETAILS = {
  [CEDENT_ID]: {
    id: CEDENT_ID,
    tenantId: TENANT,
    partyNumber: 'PTY-000001001',
    partyType: 'ORGANIZATION',
    displayName: 'Meridian Specialty',
    legalName: 'Meridian Specialty Insurance Company',
    status: 'ACTIVE',
    version: 1
  },
  [REINSURER_ID]: {
    id: REINSURER_ID,
    tenantId: TENANT,
    partyNumber: 'PTY-000002002',
    partyType: 'ORGANIZATION',
    displayName: 'Atlas Re',
    legalName: 'Atlas Reinsurance Company',
    status: 'ACTIVE',
    version: 1
  }
};

const ASSUMED_CLAIMS = [
  {
    id: 'ac-1',
    type: 'ASSUMED_CLAIM',
    label: 'AC-2026-0001',
    secondary: 'CED-77 · OPEN',
    status: 'OPEN',
    href: '/assumed-claims?record=ac-1'
  }
];

const RETROCESSIONS = [
  {
    id: 'retro-1',
    type: 'RETROCESSION',
    label: 'RET-2026-0004',
    secondary: 'ASSUMED · PLACED',
    status: 'PLACED',
    href: '/retrocession?record=retro-1'
  }
];

function jsonResponse(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockWorkspace(page, options = {}) {
  const state = { partyRequests: [] };

  await page.route('**/api/v1/contracts**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/v1/contracts') {
      if (method === 'GET') {
        return jsonResponse(route, [CONTRACT_A, CONTRACT_B]);
      }
      const body = request.postDataJSON();
      return jsonResponse(route, { ...body, id: 'new-contract-1', status: 'DRAFT', version: 0 }, 201);
    }
    if (path.endsWith('/bind-eligibility')) {
      return jsonResponse(route, {
        contractId: CONTRACT_A.id,
        contractNumber: CONTRACT_A.contractNumber,
        status: CONTRACT_A.status,
        bindable: false,
        checks: [{ code: 'CONTRACT_PLACED', passed: true, detail: 'Contract is PLACED' }]
      });
    }
    if (path.endsWith('/layers') || path.endsWith('/participants') || path.endsWith('/cessions')) {
      return jsonResponse(route, []);
    }
    return jsonResponse(route, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}`, details: [] }, 404);
  });

  await page.route('**/api/v1/parties/search**', async (route) => {
    const term = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    const items = term.includes('atlas') ? [PARTIES[REINSURER_ID]] : [PARTIES[CEDENT_ID]];
    return jsonResponse(route, { query: term, limit: 8, items });
  });

  await page.route(/\/api\/v1\/parties\/[0-9a-fA-F-]{36}$/, async (route) => {
    const request = route.request();
    const partyId = new URL(request.url()).pathname.split('/').pop();
    state.partyRequests.push({ partyId, headers: request.headers() });
    if (options.partyLookup === 'fail') {
      return jsonResponse(route, {
        code: 'UNAVAILABLE',
        message: 'Party service is unavailable'
      }, 503);
    }
    const party = PARTY_DETAILS[partyId];
    return party
      ? jsonResponse(route, party)
      : jsonResponse(route, { code: 'NOT_FOUND', message: `No party ${partyId}` }, 404);
  });

  await page.route('**/api/v1/assumed-claims/search**', async (route) =>
    jsonResponse(route, { query: CONTRACT_A.id, limit: 5, items: ASSUMED_CLAIMS })
  );

  await page.route('**/api/v1/retrocessions/search**', async (route) =>
    jsonResponse(route, { query: CONTRACT_A.id, limit: 5, items: RETROCESSIONS })
  );

  return state;
}

test('opens a contract directly from the record URL and follows popstate', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto(`/?record=${CONTRACT_A.id}`);

  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_A.contractNumber })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('PLACED');
  await expect(page).toHaveURL(new RegExp(`record=${CONTRACT_A.id}$`));

  // Selecting another contract pushes its record URL; browser back restores the first.
  await page.locator('.eia-record-list button').filter({ hasText: CONTRACT_B.contractNumber }).click();
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_B.contractNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${CONTRACT_B.id}$`));

  await page.goBack();
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_A.contractNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${CONTRACT_A.id}$`));
});

test('opens the create form from ?new=1 and keeps the URL in step', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/?new=1');

  await expect(page.getByRole('heading', { name: 'New assumed contract' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'New assumed contract' })).toHaveCount(0);
  await expect(page).not.toHaveURL(/new=1/);

  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByRole('heading', { name: 'New assumed contract' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);
});

test('filters the contract queue by number, type, cedent, and status with a clear action', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/');

  const filter = page.getByPlaceholder('Filter contracts by number, type, cedent, or status…');
  const register = page.locator('.eia-record-list');
  const contractA = register.locator('button').filter({ hasText: CONTRACT_A.contractNumber });
  const contractB = register.locator('button').filter({ hasText: CONTRACT_B.contractNumber });

  await expect(contractA).toBeVisible();
  await expect(contractB).toBeVisible();

  await filter.fill('quota');
  await expect(contractB).toBeVisible();
  await expect(contractA).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-count')).toHaveText('1 of 2 contracts');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(contractA).toBeVisible();
  await expect(contractB).toBeVisible();

  await filter.fill('BOUND');
  await expect(contractB).toBeVisible();
  await expect(contractA).toHaveCount(0);

  await filter.fill('Meridian');
  await expect(contractA).toBeVisible();
  await expect(contractB).toHaveCount(0);

  await filter.fill('no-such-contract');
  await expect(page.getByTestId('queue-filter-empty')).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(contractA).toBeVisible();
  await expect(contractB).toBeVisible();
});

test('picks the cedent and reinsurer predictively and posts both party ids', async ({ page }) => {
  await mockWorkspace(page);
  let postBody = null;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/contracts') {
      postBody = request.postDataJSON();
    }
  });

  await page.goto('/?new=1');
  await expect(page.getByRole('heading', { name: 'New assumed contract' })).toBeVisible();

  const picker = page.getByPlaceholder('Search by number or name…');
  await expect(picker).toHaveCount(2);

  await picker.first().fill('Meridian');
  await page.locator('.eia-picker-option').filter({ hasText: 'P-1001' }).click();
  await expect(page.getByTestId('cedent-picker-link')).toHaveAttribute('href', `/party?record=${CEDENT_ID}`);
  await expect(page.locator('.eia-picker-selected')).toContainText('Meridian Specialty');

  await picker.fill('Atlas');
  await page.locator('.eia-picker-option').filter({ hasText: 'P-2002' }).click();
  await expect(page.getByTestId('reinsurer-picker-link')).toHaveAttribute('href', `/party?record=${REINSURER_ID}`);
  await expect(page.locator('.eia-picker-selected').filter({ hasText: 'Atlas Re' })).toBeVisible();

  await page.getByLabel('Contract number').fill('XOL-2026-00099');
  await page.getByRole('button', { name: 'Create draft contract' }).click();

  await expect.poll(() => postBody && postBody.cedentPartyId).toBe(CEDENT_ID);
  expect(postBody.reinsurerPartyId).toBe(REINSURER_ID);
  expect(postBody.contractNumber).toBe('XOL-2026-00099');
});

test('shows party cross-links, the contract context panel, and both related-record groups', async ({ page }) => {
  const state = await mockWorkspace(page);
  const relatedRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/assumed-claims/search') || url.includes('/api/v1/retrocessions/search')) {
      relatedRequests.push({ url, book: request.headers()['x-eia-book'] });
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_A.contractNumber })).toBeVisible();

  await expect(page.getByTestId('cedent-party-link')).toHaveAttribute('href', `/party?record=${CEDENT_ID}`);
  await expect(page.getByTestId('cedent-party-link')).toHaveText('Meridian Specialty · PTY-000001001');
  await expect(page.getByTestId('reinsurer-party-link')).toHaveAttribute('href', `/party?record=${REINSURER_ID}`);
  await expect(page.getByTestId('reinsurer-party-link')).toHaveText('Atlas Re · PTY-000002002');

  const context = page.getByTestId('why-this-matters');
  await expect(context).toContainText('Why this matters');
  await expect(context).toContainText('Assumed claims and retrocessions attach to this contract');
  await expect(context).toContainText('Actual cessions remain FS-RI-owned');

  const assumedGroup = page.getByTestId('related-assumed-claims');
  await expect(assumedGroup).toContainText('Assumed claims');
  await expect(assumedGroup.getByRole('link', { name: /AC-2026-0001/ })).toHaveAttribute(
    'href',
    '/assumed-claims?record=ac-1'
  );

  const retroGroup = page.getByTestId('related-retrocessions');
  await expect(retroGroup).toContainText('Retrocessions');
  await expect(retroGroup.getByRole('link', { name: /RET-2026-0004/ })).toHaveAttribute(
    'href',
    '/retrocession?record=retro-1'
  );

  await expect.poll(() => relatedRequests.length).toBe(2);
  const assumedRequest = relatedRequests.find((request) => request.url.includes('/assumed-claims/search'));
  const retroRequest = relatedRequests.find((request) => request.url.includes('/retrocessions/search'));
  expect(assumedRequest.url).toContain(`/api/v1/assumed-claims/search?q=${CONTRACT_A.id}&limit=5`);
  expect(retroRequest.url).toContain(`/api/v1/retrocessions/search?q=${CONTRACT_A.id}&limit=5`);
  expect(assumedRequest.book).toBe('ASSUMED');
  expect(retroRequest.book).toBe('ASSUMED');

  await expect.poll(() => state.partyRequests.length).toBe(2);
  expect(state.partyRequests.map((request) => request.partyId).sort())
    .toEqual([CEDENT_ID, REINSURER_ID].sort());
  expect(state.partyRequests.every((request) => request.headers['x-eia-book'] === 'ASSUMED')).toBe(true);
  expect(state.partyRequests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('resolves cedent and reinsurer labels through the Party API in every cross-link', async ({ page }) => {
  const state = await mockWorkspace(page);

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_A.contractNumber })).toBeVisible();

  const expectations = [
    ['cedent-party-link-header', CEDENT_ID, 'Meridian Specialty · PTY-000001001'],
    ['cedent-party-link', CEDENT_ID, 'Meridian Specialty · PTY-000001001'],
    ['cedent-party-link-related', CEDENT_ID, 'Meridian Specialty · PTY-000001001'],
    ['reinsurer-party-link-header', REINSURER_ID, 'Atlas Re · PTY-000002002'],
    ['reinsurer-party-link', REINSURER_ID, 'Atlas Re · PTY-000002002'],
    ['reinsurer-party-link-related', REINSURER_ID, 'Atlas Re · PTY-000002002']
  ];

  for (const [testId, partyId, label] of expectations) {
    const link = page.getByTestId(testId);
    await expect(link).toHaveText(label);
    await expect(link).toHaveAttribute('href', `/party?record=${partyId}`);
  }

  await expect.poll(() => state.partyRequests.length).toBe(2);
  for (const request of state.partyRequests) {
    expect(request.headers['x-eia-book']).toBe('ASSUMED');
    expect(request.headers['x-eia-tenant']).toBe(TENANT);
  }
});

test('renders the contract while party lookup fails and falls back to short party ids', async ({ page }) => {
  const state = await mockWorkspace(page, { partyLookup: 'fail' });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: CONTRACT_A.contractNumber })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('PLACED');

  const shortCedentId = CEDENT_ID.slice(0, 8);
  const shortReinsurerId = REINSURER_ID.slice(0, 8);
  const expectations = [
    ['cedent-party-link-header', shortCedentId],
    ['cedent-party-link', shortCedentId],
    ['cedent-party-link-related', shortCedentId],
    ['reinsurer-party-link-header', shortReinsurerId],
    ['reinsurer-party-link', shortReinsurerId],
    ['reinsurer-party-link-related', shortReinsurerId]
  ];

  for (const [testId, label] of expectations) {
    await expect(page.getByTestId(testId)).toHaveText(label);
  }

  await expect.poll(() => state.partyRequests.length).toBe(2);
  expect(state.partyRequests.every((request) => request.headers['x-eia-book'] === 'ASSUMED')).toBe(true);
  expect(state.partyRequests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});
