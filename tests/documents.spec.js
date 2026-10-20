import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PARTY_ID = '44444444-4444-7444-8444-444444444444';
const OTHER_PARTY_ID = '55555555-5555-7555-8555-555555555555';

const CONTRACT_A = {
  id: '22222222-2222-7222-8222-222222222222',
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: PARTY_ID,
  status: 'DRAFT',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 1
};

const CONTRACT_B = {
  ...CONTRACT_A,
  id: '66666666-6666-7666-8666-666666666666',
  contractNumber: 'XOL-2026-00092',
  cedentPartyId: OTHER_PARTY_ID,
  status: 'PLACED',
  version: 3
};

const DOCUMENT_A = {
  id: '77777777-7777-7777-8777-777777777777',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0001',
  title: 'Treaty slip',
  documentType: 'TREATY_SLIP',
  status: 'ACTIVE'
};

const DOCUMENT_B = {
  id: '88888888-8888-8888-8888-888888888888',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0002',
  title: 'Bordereau statement',
  documentType: 'BORDEREAU',
  status: 'ARCHIVED'
};

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/**
 * Mocks everything the contract workbench calls on selection: the register,
 * bind eligibility, the summary resources, related searches, party lookups,
 * and the linked-document list. `gate` keeps the document response pending so
 * a test can observe the record while the Document API is still in flight.
 */
async function mockContractApi(page, {
  contracts = [CONTRACT_A],
  documentsResponse = [],
  documentsStatus = 200,
  gate = null,
  onDocuments = null
} = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/contracts') {
      await json(route, 200, contracts);
      return;
    }
    if (method === 'GET' && path.endsWith('/bind-eligibility')) {
      await json(route, 200, {
        contractId: path.split('/')[4],
        bindable: false,
        checks: []
      });
      return;
    }
    if (
      method === 'GET'
      && (path.endsWith('/layers') || path.endsWith('/participants') || path.endsWith('/cessions'))
    ) {
      await json(route, 200, []);
      return;
    }
    if (
      method === 'GET'
      && (path === '/api/v1/assumed-claims/search' || path === '/api/v1/retrocessions/search')
    ) {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/documents') {
      if (onDocuments) onDocuments(request, url);
      if (gate) await gate;
      await json(route, documentsStatus, documentsResponse);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('loads linked documents for the selected contract with the filter and tenant header', async ({ page }) => {
  const requests = [];

  await mockContractApi(page, {
    documentsResponse: [DOCUMENT_A, DOCUMENT_B],
    onDocuments: (request, url) => {
      requests.push({
        path: url.pathname,
        linkedType: url.searchParams.get('linkedType'),
        linkedId: url.searchParams.get('linkedId'),
        tenant: request.headers()['x-eia-tenant']
      });
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('2 documents');

  const table = page.getByTestId('documents-table');
  await expect(table.getByRole('cell', { name: 'DOC-2026-0001', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Treaty slip', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'TREATY_SLIP', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'ACTIVE', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'DOC-2026-0002', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'BORDEREAU', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'ARCHIVED', exact: true })).toBeVisible();

  // Each document number opens the document workbench on that record.
  await expect(page.getByTestId('document-link-0')).toHaveText('DOC-2026-0001');
  await expect(page.getByTestId('document-link-0')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_A.id}`
  );
  await expect(page.getByTestId('document-link-1')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_B.id}`
  );

  // The existing related-records card is untouched.
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByTestId('related-records').getByRole('heading', { name: 'Related records' })).toBeVisible();

  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0]).toEqual({
    path: '/api/v1/documents',
    linkedType: 'CONTRACT',
    linkedId: CONTRACT_A.id,
    tenant: TENANT
  });
});

test('refetches linked documents when another contract is selected', async ({ page }) => {
  const requests = [];

  await mockContractApi(page, {
    contracts: [CONTRACT_A, CONTRACT_B],
    documentsResponse: [DOCUMENT_A],
    onDocuments: (request, url) => {
      requests.push({
        linkedType: url.searchParams.get('linkedType'),
        linkedId: url.searchParams.get('linkedId')
      });
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByTestId('documents-count')).toHaveText('1 document');

  await page
    .locator('.eia-record-list button')
    .filter({ hasText: CONTRACT_B.contractNumber })
    .click();

  await expect(page.getByRole('heading', { name: CONTRACT_B.contractNumber, level: 2 })).toBeVisible();
  await expect.poll(() => requests.filter((entry) => entry.linkedId === CONTRACT_B.id).length).toBe(1);
  expect(requests.every((entry) => entry.linkedType === 'CONTRACT')).toBe(true);
  await expect(page.getByTestId('documents-count')).toHaveText('1 document');
});

test('renders the empty state for a wrapped items response and keeps the record', async ({ page }) => {
  await mockContractApi(page, { documentsResponse: { items: [] } });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  await expect(page.getByTestId('documents-card')).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('0 documents');
  await expect(page.getByTestId('documents-empty')).toHaveText('No documents are linked to this contract yet.');
  await expect(page.getByTestId('documents-card')).toContainText('Documents are evidence, not business facts');
  await expect(page.getByTestId('documents-table')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('related-records')).toBeVisible();
});

test('contains a document error inside the card without disturbing the record', async ({ page }) => {
  await mockContractApi(page, {
    documentsStatus: 503,
    documentsResponse: {
      code: 'DOCUMENT_UNAVAILABLE',
      message: 'Document service unavailable'
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  const error = page.getByTestId('documents-error');
  await expect(error).toContainText('DOCUMENT_UNAVAILABLE: Document service unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(page.getByTestId('documents-count')).toHaveText('—');
  await expect(page.getByTestId('documents-table')).toHaveCount(0);

  // The document failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-limit')).toBeVisible();
  await expect(page.getByTestId('related-records')).toBeVisible();
});

test('renders the contract while a slow Document API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockContractApi(page, {
    documentsResponse: [DOCUMENT_A, DOCUMENT_B],
    gate
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  // The record and its existing cards are usable before documents resolve.
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByTestId('documents-loading')).toHaveText('Loading linked documents…');
  await expect(page.getByTestId('documents-count')).toHaveText('…');

  release();

  await expect(page.getByTestId('documents-count')).toHaveText('2 documents');
  await expect(page.getByTestId('documents-table')).toBeVisible();
});
