import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '44444444-4444-7444-8444-444444444444';

const contract = {
  id: CONTRACT_ID,
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: PARTY_ID,
  status: 'PLACED',
  effectiveDate: '2026-01-01',
  expirationDate: '2026-12-31',
  currency: 'USD',
  version: 2
};

test('records a layer and a participant, then binds the contract', async ({ page }) => {
  const layers = [];
  const participants = [];

  const shareTotal = () =>
    participants
      .filter((p) => p.status === 'ACTIVE' && p.participantRole !== 'BROKER' && p.participantRole !== 'CEDENT')
      .reduce((sum, p) => sum + Number(p.sharePct), 0);

  await page.route('**/api/v1/contracts**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/contracts') {
      if (method === 'GET') {
        return json([contract]);
      }
      return json(contract, 201);
    }
    if (path.endsWith('/bind-eligibility')) {
      const balanced = Math.abs(shareTotal() - 100) <= 0.0001;
      return json({
        contractId: CONTRACT_ID,
        contractNumber: contract.contractNumber,
        status: contract.status,
        bindable: contract.status === 'PLACED' && balanced,
        checks: [
          { code: 'CONTRACT_PLACED', passed: contract.status === 'PLACED', detail: `Contract is ${contract.status}` },
          { code: 'SHARES_BALANCED', passed: balanced, detail: `Shares total ${shareTotal().toFixed(6)}%` }
        ]
      });
    }
    if (path.endsWith('/layers')) {
      if (method === 'GET') {
        return json(layers);
      }
      const body = request.postDataJSON();
      const layer = {
        id: `layer-${layers.length + 1}`,
        tenantId: TENANT,
        contractId: CONTRACT_ID,
        sectionId: null,
        layerNumber: body.layerNumber,
        layerType: body.layerType,
        attachmentAmount: `${Number(body.attachmentAmount).toFixed(4)}`,
        limitAmount: `${Number(body.limitAmount).toFixed(4)}`,
        currency: 'USD',
        limitBasis: body.limitBasis,
        aggregateLimitAmount: null,
        reinstatementCount: null,
        reinstatementType: 'NONE',
        note: body.note || null,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        status: 'QUOTED',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      };
      layers.push(layer);
      return json(layer, 201);
    }
    if (path.endsWith('/participants')) {
      if (method === 'GET') {
        return json(participants);
      }
      const body = request.postDataJSON();
      if (Number(body.sharePct) + shareTotal() > 100.0001) {
        return json({
          code: 'SHARES_EXCEED_100',
          message: 'Participant shares would total more than 100% for this layer',
          details: []
        }, 409);
      }
      const participant = {
        id: `participant-${participants.length + 1}`,
        tenantId: TENANT,
        contractId: CONTRACT_ID,
        layerId: body.layerId || null,
        partyId: body.partyId,
        participantRole: body.participantRole,
        sharePct: `${Number(body.sharePct).toFixed(6)}`,
        signedLinePct: null,
        orderNumber: 1,
        leadFlag: Boolean(body.leadFlag),
        capacityAmount: null,
        securityRating: null,
        collateralRequired: false,
        signatureStatus: body.signatureStatus || 'PENDING',
        signedAt: null,
        authorizationRef: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      };
      participants.push(participant);
      return json(participant, 201);
    }
    if (path.endsWith('/bind') && method === 'POST') {
      contract.status = 'BOUND';
      contract.version = 3;
      return json({
        contract,
        eligibility: { contractId: CONTRACT_ID, contractNumber: contract.contractNumber, status: 'PLACED', bindable: true, checks: [] }
      });
    }
    return json({ code: 'NOT_FOUND', message: `Unhandled ${method} ${path}`, details: [] }, 404);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Contract', level: 1 })).toBeVisible();

  const registerEntry = page.locator('.eia-record-list button').filter({ hasText: 'XOL-2026-00091' });
  await expect(registerEntry).toBeVisible();
  await registerEntry.click();

  // The record panel exposes the contract identity, status, and bind action.
  await expect(page.locator('.eia-record-panel').getByRole('heading', { name: 'XOL-2026-00091' })).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('PLACED');
  await expect(page.getByTestId('contract-bound-state')).toHaveText('Unbound');
  await expect(page.getByRole('button', { name: 'Bind contract' })).toBeDisabled();

  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();

  await page.getByLabel('Layer number').fill('1');
  await page.getByLabel('Attachment amount').fill('0');
  await page.getByLabel('Limit amount').fill('1000000');
  await page.getByRole('button', { name: 'Add layer' }).click();

  await expect(page.getByRole('cell', { name: '1000000.0000' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'EXCESS_OF_LOSS' })).toBeVisible();
  await expect(page.getByTestId('summary-limit')).toHaveText('$1,000,000');

  await page.getByRole('button', { name: 'Participants', exact: true }).click();
  await expect(page.getByTestId('participants-panel')).toBeVisible();
  await page.getByLabel('Layer').selectOption({ label: 'Layer 1' });
  await page.getByLabel('Party id').fill(PARTY_ID);
  await page.getByLabel('Share percent').fill('100');
  await page.getByRole('button', { name: 'Add participant' }).click();

  await expect(page.getByRole('cell', { name: 'REINSURER' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '100.000000' })).toBeVisible();
  await expect(page.getByTestId('share-totals')).toContainText('Layer 1 total: 100.000000% (balanced)');
  await expect(page.getByTestId('summary-share')).toHaveText('100.00%');

  const bindButton = page.getByRole('button', { name: 'Bind contract' });
  await expect(bindButton).toBeEnabled();
  await bindButton.click();
  await expect(page.getByText('Contract XOL-2026-00091 is BOUND.')).toBeVisible();
  await expect(page.getByTestId('contract-status')).toHaveText('BOUND');
  await expect(page.getByTestId('contract-bound-state')).toHaveText('Bound');
});

test('rejects participant shares that would exceed 100 percent', async ({ page }) => {
  const participants = [];

  await page.route('**/api/v1/contracts**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/contracts') {
      return json([{ ...contract, status: 'PLACED' }]);
    }
    if (path.endsWith('/bind-eligibility')) {
      return json({ contractId: CONTRACT_ID, contractNumber: contract.contractNumber, status: 'PLACED', bindable: false, checks: [] });
    }
    if (path.endsWith('/layers')) {
      return json([]);
    }
    if (path.endsWith('/participants')) {
      if (request.method() === 'GET') {
        return json(participants);
      }
      const body = request.postDataJSON();
      const total = participants.reduce((sum, p) => sum + Number(p.sharePct), 0);
      if (total + Number(body.sharePct) > 100.0001) {
        return json({ code: 'SHARES_EXCEED_100', message: 'Participant shares would total 110% for this layer', details: [] }, 409);
      }
      const participant = {
        id: `participant-${participants.length + 1}`,
        contractId: CONTRACT_ID,
        layerId: null,
        partyId: body.partyId,
        participantRole: body.participantRole,
        sharePct: `${Number(body.sharePct).toFixed(6)}`,
        status: 'ACTIVE',
        signatureStatus: 'PENDING'
      };
      participants.push(participant);
      return json(participant, 201);
    }
    return json({ code: 'NOT_FOUND', message: 'unhandled', details: [] }, 404);
  });

  await page.goto('/');
  await page.locator('.eia-record-list button').filter({ hasText: 'XOL-2026-00091' }).click();
  await page.getByRole('button', { name: 'Participants', exact: true }).click();

  await page.getByLabel('Party id').fill(PARTY_ID);
  await page.getByLabel('Share percent').fill('70');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByRole('cell', { name: '70.000000' })).toBeVisible();

  await page.getByLabel('Party id').fill('99999999-9999-7999-8999-999999999999');
  await page.getByLabel('Share percent').fill('40');
  await page.getByRole('button', { name: 'Add participant' }).click();

  await expect(page.getByRole('alert')).toContainText('SHARES_EXCEED_100');
  await expect(page.getByTestId('share-totals')).toContainText('70.000000%');
});
