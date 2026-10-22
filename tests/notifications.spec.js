import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';

const CONTRACT_A = {
  id: '22222222-2222-7222-8222-222222222222',
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: '44444444-4444-7444-8444-444444444444',
  status: 'DRAFT',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 1
};

const CONTRACT_B = {
  ...CONTRACT_A,
  id: '55555555-5555-7555-8555-555555555555',
  contractNumber: 'XOL-2026-00092',
  status: 'PLACED',
  version: 3
};

function notification(overrides = {}) {
  return {
    id: '99999999-9999-7999-8999-999999999991',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000001',
    notificationType: 'CONTRACT_BOUND',
    channel: 'EMAIL',
    status: 'SENT',
    subject: 'Contract bound',
    sourceType: 'CONTRACT',
    sourceId: CONTRACT_A.id,
    sourceReference: CONTRACT_A.contractNumber,
    createdAt: '2026-10-18T12:00:00Z',
    updatedAt: '2026-10-18T12:00:00Z',
    ...overrides
  };
}

// Deliberately newest-last and mixed with rows that point at another contract or
// another source: the card must show only this contract's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '99999999-9999-7999-8999-999999999911',
  notificationNumber: 'NTF-2026-000011',
  notificationType: 'CONTRACT_BOUND',
  status: 'DELIVERED',
  subject: 'Contract bound by the lead',
  createdAt: '2026-10-20T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '99999999-9999-7999-8999-999999999922',
  notificationNumber: 'NTF-2026-000022',
  notificationType: 'TECHNICAL_ACCOUNT_ISSUED',
  status: 'READ',
  subject: 'Technical account issued',
  createdAt: '2026-10-19T16:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '99999999-9999-7999-8999-999999999933',
  notificationNumber: 'NTF-2026-000033',
  notificationType: 'CASH_CALL_ISSUED',
  status: 'QUEUED',
  subject: 'Cash call issued',
  createdAt: '2026-10-18T08:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '99999999-9999-7999-8999-999999999944',
  notificationNumber: 'NTF-2026-000044',
  notificationType: 'CONTRACT_SIGNED',
  status: 'FAILED',
  subject: 'Signed slip delivery failed',
  createdAt: '2026-10-01T07:00:00Z'
});

const NOTIFICATION_OTHER_CONTRACT = notification({
  id: '99999999-9999-7999-8999-999999999955',
  notificationNumber: 'NTF-2026-000055',
  sourceId: CONTRACT_B.id,
  sourceReference: CONTRACT_B.contractNumber,
  subject: 'Other contract notice',
  createdAt: '2026-10-21T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '99999999-9999-7999-8999-999999999966',
  notificationNumber: 'NTF-2026-000066',
  sourceType: 'PAYMENT',
  subject: 'Payment settled',
  createdAt: '2026-10-22T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_CONTRACT,
  NOTIFICATION_OTHER_SOURCE
];

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks everything the contract workbench calls on selection: the register,
 * bind eligibility, the summary resources, related searches, party lookups,
 * linked documents, and the related-notification lookup. `gate` keeps the
 * notification response pending so a test can observe the record while the
 * Notifications API is still in flight.
 */
async function mockContractApi(page, {
  contracts = [CONTRACT_A],
  notificationsResponse = RELATED,
  notificationsStatus = 200,
  notificationsTotal = undefined,
  gate = null,
  onNotifications = null
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
      await json(route, 200, { contractId: path.split('/')[4], bindable: false, checks: [] });
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
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      if (onNotifications) onNotifications(request, url);
      if (gate) await gate;
      const body = notificationsTotal === undefined
        ? notificationsResponse
        : { items: notificationsResponse, total: notificationsTotal };
      await json(route, notificationsStatus, body);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('shows the count and newest three related notifications with the source query', async ({ page }) => {
  const requests = [];

  await mockContractApi(page, {
    contracts: [CONTRACT_A, CONTRACT_B],
    onNotifications: (request, url) => {
      requests.push({
        method: request.method(),
        path: url.pathname,
        sourceType: url.searchParams.get('sourceType'),
        sourceId: url.searchParams.get('sourceId'),
        tenant: request.headers()['x-eia-tenant'],
        book: request.headers()['x-eia-book'] || null
      });
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Related notifications' })).toBeVisible();
  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notifications-more'))
    .toHaveText('Showing the newest 3 of 4.');

  const rows = card.getByTestId('related-notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first; the oldest related row and the unrelated rows stay hidden.
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.notificationNumber);
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.subject);
  await expect(rows.nth(0)).toContainText('DELIVERED');
  await expect(rows.nth(0).getByTestId('related-notification-status')).toHaveClass(/green/);
  await expect(rows.nth(0)).toContainText(/Oct 20, 2026/);
  await expect(rows.nth(1)).toContainText(NOTIFICATION_MIDDLE.notificationNumber);
  await expect(rows.nth(1)).toContainText('READ');
  await expect(rows.nth(2)).toContainText(NOTIFICATION_OLD.notificationNumber);
  await expect(rows.nth(2)).toContainText('QUEUED');
  await expect(rows.nth(2).getByTestId('related-notification-status')).toHaveClass(/amber/);
  await expect(card.getByText(NOTIFICATION_OLDEST.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_CONTRACT.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_SOURCE.notificationNumber)).toHaveCount(0);

  // Each notification number opens that notification record.
  await expect(card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`))
    .toHaveAttribute('href', `/notifications?record=${NOTIFICATION_NEWEST.id}`);

  // View all keeps the contract's source filter.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=CONTRACT&sourceId=${CONTRACT_A.id}`
  );
  await expect(card).toContainText('opens the Notifications queue filtered to this contract');

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    method: 'GET',
    path: '/api/v1/notifications',
    sourceType: 'CONTRACT',
    sourceId: CONTRACT_A.id,
    tenant: TENANT,
    book: null
  });

  // Selecting another contract refetches notifications for its source id.
  await page
    .locator('.eia-record-list button')
    .filter({ hasText: CONTRACT_B.contractNumber })
    .click();
  await expect(page.getByRole('heading', { name: CONTRACT_B.contractNumber, level: 2 })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].sourceType).toBe('CONTRACT');
  expect(requests[1].sourceId).toBe(CONTRACT_B.id);
  expect(requests[1].tenant).toBe(TENANT);
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card).toContainText(NOTIFICATION_OTHER_CONTRACT.subject);
});

test('accepts an {items} envelope and renders a single notification', async ({ page }) => {
  await mockContractApi(page, {
    notificationsResponse: [notification({ status: 'SENT' })],
    notificationsTotal: 1
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card.getByTestId('related-notification-row')).toContainText('NTF-2026-000001');
  await expect(card.getByTestId('related-notification-row')).toContainText(/Oct 18, 2026/);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows the empty state without disturbing the contract record', async ({ page }) => {
  await mockContractApi(page, { notificationsResponse: { items: [], total: 0 } });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(card.getByTestId('related-notifications-empty'))
    .toHaveText('No notifications reference this contract yet.');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);

  // The card is still a working hand-off, and the record is untouched.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=CONTRACT&sourceId=${CONTRACT_A.id}`
  );
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-limit')).toBeVisible();
  await expect(page.getByTestId('documents-card')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a Notifications failure inside the card', async ({ page }) => {
  await mockContractApi(page, {
    notificationsStatus: 503,
    notificationsResponse: {
      code: 'NOTIFICATIONS_UNAVAILABLE',
      message: 'Notification service is unavailable'
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  const error = card.getByTestId('related-notifications-error');
  await expect(error).toContainText('Related notifications are temporarily unavailable');
  await expect(error).toContainText('NOTIFICATIONS_UNAVAILABLE: Notification service is unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('—');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-view-all')).toBeVisible();

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-limit')).toBeVisible();
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByTestId('documents-card')).toBeVisible();
});

test('renders the contract while the Notifications API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockContractApi(page, { notificationsResponse: RELATED, gate });

  await page.goto(`/?record=${CONTRACT_A.id}`);

  // The record and its existing Overview cards are usable before notifications resolve.
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByTestId('documents-card')).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-loading')).toHaveText(
    'Loading related notifications…'
  );
  await expect(card.getByTestId('related-notifications-count')).toHaveText('…');

  release();

  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(3);
});

test('opens a notification record and the filtered Notifications queue', async ({ page }) => {
  await mockContractApi(page);

  await page.goto(`/?record=${CONTRACT_A.id}`);
  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();

  await card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByTestId('related-notifications')).toBeVisible();
  await page.getByTestId('related-notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=CONTRACT&sourceId=${CONTRACT_A.id}$`)
  );
});
