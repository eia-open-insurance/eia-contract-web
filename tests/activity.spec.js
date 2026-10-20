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

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const STATUS_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';

/** One aggregate event in the shape the event service embeds. */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = CONTRACT_A.id,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: 'ASSUMED',
    aggregateType: 'Contract',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent(aggregateId = CONTRACT_A.id) {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'contract.contract.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    aggregateId,
    data: {
      contractId: aggregateId,
      contractNumber: CONTRACT_A.contractNumber,
      status: 'DRAFT',
      version: 0
    }
  });
}

function statusChangedEvent(aggregateId = CONTRACT_A.id) {
  return aggregateEvent({
    eventId: STATUS_EVENT_ID,
    eventType: 'contract.status-changed',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    aggregateId,
    data: { from: 'DRAFT', to: 'QUOTED', version: 1 }
  });
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks everything the contract workbench calls on selection: the register,
 * bind eligibility, the summary resources, related searches, party lookups,
 * linked documents, and the aggregate activity endpoint.
 */
async function mockContractApi(page, {
  contracts = [CONTRACT_A],
  onEvents = null,
  eventsBody = { items: [] },
  eventsStatus = 200
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
    if (method === 'GET' && path === '/api/v1/events/aggregate/') {
      await json(route, 404, { code: 'NOT_FOUND', message: 'Aggregate is required' });
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      if (onEvents) await onEvents({ route, url, request });
      if (eventsBody) await json(route, eventsStatus, eventsBody);
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
    if (method === 'GET' && /^\/api\/v1\/parties\/[0-9a-f-]+$/i.test(path)) {
      await json(route, 404, { code: 'PARTY_NOT_FOUND', message: 'Party was not found' });
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('loads activity for the selected contract with tenant header, newest first, and refetches on selection', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockContractApi(page, {
    contracts: [CONTRACT_A, CONTRACT_B],
    eventsBody: null,
    onEvents: async ({ route, url, request }) => {
      const position = requests.push({
        method: request.method(),
        path: url.pathname,
        limit: url.searchParams.get('limit'),
        tenant: request.headers()['x-eia-tenant'],
        contractId: url.pathname.split('/').pop()
      });

      if (position === 1) await firstGate;

      if (url.pathname.endsWith(CONTRACT_A.id)) {
        // Deliberately oldest-first: the card must present newest-first.
        await json(route, 200, {
          aggregateId: CONTRACT_A.id,
          limit: 50,
          items: [createdEvent(), statusChangedEvent()]
        });
        return;
      }
      await json(route, 200, {
        aggregateId: CONTRACT_B.id,
        limit: 50,
        items: [createdEvent(CONTRACT_B.id)]
      });
    }
  });

  try {
    await page.goto(`/?record=${CONTRACT_A.id}`);
    await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();

    // Selection alone fetches the timeline, before the Activity tab is opened.
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/api/v1/events/aggregate/${CONTRACT_A.id}`,
      limit: '50',
      tenant: TENANT,
      contractId: CONTRACT_A.id
    });

    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    const card = page.getByTestId('contract-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Contract status changed');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest.getByTestId('activity-fact-status')).toContainText('DRAFT → QUOTED');
    await expect(newest.getByTestId('activity-fact-version')).toContainText('Version 1');

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Contract created');
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('DRAFT');
    await expect(oldest.getByTestId('activity-fact-version')).toContainText('Version 0');

    // Selecting another contract refetches the timeline for its aggregate id.
    await page
      .locator('.eia-record-list button')
      .filter({ hasText: CONTRACT_B.contractNumber })
      .click();
    await expect(page.getByRole('heading', { name: CONTRACT_B.contractNumber, level: 2 })).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].path).toBe(`/api/v1/events/aggregate/${CONTRACT_B.id}`);
    expect(requests[1].tenant).toBe(TENANT);

    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
    await expect(card.getByTestId('activity-item')).toHaveCount(1);

    // The card's own Refresh re-reads the same aggregate without changing selection.
    await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2].path).toBe(`/api/v1/events/aggregate/${CONTRACT_B.id}`);
    expect(requests[2].limit).toBe('50');
    expect(requests[2].tenant).toBe(TENANT);
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  await mockContractApi(page, {
    eventsBody: { aggregateId: CONTRACT_A.id, limit: 50, items: [] }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();

  const card = page.getByTestId('contract-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toHaveText(
    'No activity has been recorded for this contract yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');

  // The record itself is untouched by an empty timeline.
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  await mockContractApi(page, {
    eventsStatus: 503,
    eventsBody: {
      code: 'EVENT_STORE_UNAVAILABLE',
      message: 'Event service unavailable'
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();

  const card = page.getByTestId('contract-activity');
  const error = card.getByTestId('activity-error');
  await expect(error).toContainText('Activity timeline is temporarily unavailable');
  await expect(error).toContainText('EVENT_STORE_UNAVAILABLE: Event service unavailable');
  await expect(error).toContainText('The contract record is unaffected.');
  await expect(card.getByTestId('activity-count')).toHaveText('—');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('contract-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('summary-limit')).toBeVisible();

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contract details' })).toBeVisible();
  await expect(page.getByTestId('related-records')).toBeVisible();
});

test('renders status, bind, cession, and commutation facts from the event payload', async ({ page }) => {
  const boundId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3';
  const cessionId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4';
  const commutedId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee5';

  await mockContractApi(page, {
    eventsBody: {
      aggregateId: CONTRACT_A.id,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: commutedId,
          eventType: 'contract.contract.commuted',
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 6,
          data: {
            from: 'IN_FORCE',
            to: 'COMMUTED',
            version: 5,
            commutationNumber: 'COM-2026-0001',
            commutationType: 'FULL',
            commutationBasis: 'NEGOTIATED',
            agreedAmount: '2650000.00',
            currency: 'USD',
            commutationEffectiveDate: '2026-09-30'
          }
        }),
        aggregateEvent({
          eventId: cessionId,
          eventType: 'contract.cession.recorded',
          occurredAt: '2026-10-19T11:00:00Z',
          aggregateVersion: 4,
          data: {
            cessionNumber: 'CES-2026-0001',
            cededPremiumAmount: '250000.0000',
            cededLossAmount: '100000.0000',
            currency: 'USD',
            version: 4
          }
        }),
        aggregateEvent({
          eventId: boundId,
          eventType: 'contract.contract.bound',
          occurredAt: '2026-10-19T08:00:00Z',
          aggregateVersion: 3,
          data: {
            from: 'PLACED',
            to: 'BOUND',
            version: 2,
            approvedBy: '66666666-6666-7666-8666-666666666666'
          }
        })
      ]
    }
  });

  await page.goto(`/?record=${CONTRACT_A.id}`);
  await expect(page.getByRole('heading', { name: CONTRACT_A.contractNumber, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(3);

  const commutation = items.nth(0);
  await expect(commutation.getByTestId('activity-type')).toHaveText('Contract commuted');
  await expect(commutation.getByTestId('activity-fact-status')).toContainText('IN_FORCE → COMMUTED');
  await expect(commutation.getByTestId('activity-fact-version')).toContainText('Version 5');
  await expect(commutation.getByTestId('activity-fact-commutation')).toContainText('COM-2026-0001');
  await expect(commutation.getByTestId('activity-fact-commutation-type')).toContainText('FULL');
  await expect(commutation.getByTestId('activity-fact-commutation-basis')).toContainText('NEGOTIATED');
  await expect(commutation.getByTestId('activity-fact-agreed-amount')).toContainText('$2,650,000.00');
  await expect(commutation.getByTestId('activity-fact-commutation-effective')).toContainText(
    '2026-09-30'
  );

  const cession = items.nth(1);
  await expect(cession.getByTestId('activity-type')).toHaveText('Contract cession recorded');
  await expect(cession.getByTestId('activity-fact-cession')).toContainText('CES-2026-0001');
  await expect(cession.getByTestId('activity-fact-ceded-premium')).toContainText('$250,000.00');
  await expect(cession.getByTestId('activity-fact-ceded-loss')).toContainText('$100,000.00');

  const bind = items.nth(2);
  await expect(bind.getByTestId('activity-type')).toHaveText('Contract bound');
  await expect(bind.getByTestId('activity-fact-status')).toContainText('PLACED → BOUND');
  await expect(bind.getByTestId('activity-fact-approval')).toContainText(
    'Bind approval 66666666-6666-7666-8666-666666666666'
  );
});
