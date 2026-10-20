import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const LAYER_ID = '55555555-5555-7555-8555-555555555555';

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

const layer = {
  id: LAYER_ID,
  contractId: CONTRACT_ID,
  layerNumber: 1,
  layerType: 'EXCESS_OF_LOSS',
  attachmentAmount: '0.0000',
  limitAmount: '1000000.0000',
  currency: 'USD',
  limitBasis: 'PER_OCCURRENCE',
  status: 'QUOTED'
};

test('records a cession within capacity and rejects one that exceeds the contract limit', async ({ page }) => {
  const cessions = [];

  const usedLoss = () =>
    cessions
      .filter((cession) => cession.status === 'RECORDED' || cession.status === 'CONFIRMED')
      .reduce((sum, cession) => sum + Number(cession.cededLossAmount || 0), 0);

  await page.route('**/api/v1/contracts**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/v1/contracts') {
      return json([contract]);
    }
    if (path.endsWith('/bind-eligibility')) {
      return json({
        contractId: CONTRACT_ID,
        contractNumber: contract.contractNumber,
        status: contract.status,
        bindable: false,
        checks: []
      });
    }
    if (path.endsWith('/layers')) {
      return json([layer]);
    }
    if (path.endsWith('/cessions')) {
      if (method === 'GET') {
        return json(cessions);
      }
      const body = request.postDataJSON();
      const loss = Number(body.cededLossAmount || 0);
      if (usedLoss() + loss > 1000000) {
        return json({
          code: 'CESSION_EXCEEDS_CONTRACT_LIMIT',
          message: `Ceded loss ${(usedLoss() + loss).toFixed(4)} exceeds 1000000.0000 available on layer 1`,
          details: [{ field: 'cededLossAmount', message: 'SPEC CTR-04 forbids a cession beyond available capacity' }]
        }, 409);
      }
      if (!body.claimRef && !body.policyRef) {
        return json({ code: 'CES_CLAIM_REF_REQUIRED', message: 'A CLAIM cession requires claimRef', details: [] }, 400);
      }
      const cession = {
        id: `cession-${cessions.length + 1}`,
        tenantId: TENANT,
        contractId: CONTRACT_ID,
        layerId: body.layerId || null,
        cessionNumber: `CES-2026-0000${cessions.length + 1}`,
        sourceVertical: 'ASSUMED',
        sourceType: body.sourceType,
        policyRef: body.policyRef || null,
        claimRef: body.claimRef || null,
        cessionType: body.cessionType,
        cessionPct: body.cessionPct ? `${Number(body.cessionPct).toFixed(6)}` : null,
        cededPremiumAmount: body.cededPremiumAmount ? `${Number(body.cededPremiumAmount).toFixed(4)}` : null,
        cededLossAmount: body.cededLossAmount ? `${Number(body.cededLossAmount).toFixed(4)}` : null,
        currency: 'USD',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        treatyYear: 2026,
        status: 'RECORDED',
        bordereauId: null,
        recordedAt: '2026-06-01T00:00:00Z',
        version: 0
      };
      cessions.push(cession);
      return json(cession, 201);
    }
    return json({ code: 'NOT_FOUND', message: `Unhandled ${method} ${path}`, details: [] }, 404);
  });

  await page.goto('/');
  await page.locator('.eia-record-list button').filter({ hasText: 'XOL-2026-00091' }).click();
  await page.getByRole('button', { name: 'Cessions', exact: true }).click();
  await expect(page.getByTestId('cessions-panel')).toBeVisible();

  await page.getByLabel('Cession layer').selectOption({ label: 'Layer 1' });
  await page.getByLabel('Claim reference').fill('CLM-2026-0007');
  await page.getByLabel('Policy reference').fill('POL-2026-0001');
  await page.getByLabel('Cession percent').fill('40');
  await page.getByLabel('Ceded premium').fill('400000');
  await page.getByLabel('Ceded loss').fill('240000');
  await page.getByRole('button', { name: 'Record cession' }).click();

  await expect(page.getByRole('cell', { name: 'CES-2026-00001' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '240000.0000' })).toBeVisible();
  await expect(page.getByText('Cession recorded.')).toBeVisible();
  await expect(page.getByTestId('summary-ceded-loss')).toHaveText('$240,000');

  // The same ceded loss is now 240000; a further 900000 pushes the tower over its limit.
  await page.getByLabel('Claim reference').fill('CLM-2026-0008');
  await page.getByLabel('Ceded loss').fill('900000');
  await page.getByRole('button', { name: 'Record cession' }).click();

  await expect(page.getByRole('alert')).toContainText('CESSION_EXCEEDS_CONTRACT_LIMIT');
  await expect(page.getByRole('alert')).toContainText('1140000.0000 exceeds 1000000.0000');
});
