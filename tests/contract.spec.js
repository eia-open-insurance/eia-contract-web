import { test, expect } from '@playwright/test';

const contract = {
  id: '1',
  contractNumber: 'XOL-2025-00091',
  contractType: 'EXCESS_OF_LOSS',
  status: 'DRAFT',
  effectiveDate: '2025-01-01',
  expirationDate: '2025-12-31',
  currency: 'USD',
  cedentPartyId: '33333333-3333-7333-8333-333333333333',
  reinsurerPartyId: '44444444-4444-7444-8444-444444444444',
  version: 1
};

test('renders the operational contract page with header, book badge, and register', async ({ page }) => {
  await page.route('**/api/v1/contracts', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([contract])
      });
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Contract', level: 1 })).toBeVisible();
  await expect(page.getByText('Reinsurance · Assumed book')).toBeVisible();
  await expect(page.getByText('Assumed reinsurance treaties, facultative placements, and their lifecycle.')).toBeVisible();
  await expect(page.getByTestId('book-badge')).toHaveText(/ASSUMED/);

  await expect(page.locator('.eia-page-head')).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();

  const registerEntry = page.locator('.eia-record-list button').filter({ hasText: 'XOL-2025-00091' });
  await expect(registerEntry).toBeVisible();
  await expect(registerEntry).toContainText('Cedent');
  await expect(registerEntry).toContainText('DRAFT');

  await expect(page.getByText(/Select a contract from the register/)).toBeVisible();
});

test('creates a draft contract from the primary action', async ({ page }) => {
  const created = [];
  let postBody = null;

  await page.route('**/api/v1/contracts', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created)
      });
      return;
    }
    postBody = request.postDataJSON();
    const record = {
      id: 'new-contract-1',
      status: 'DRAFT',
      version: 0,
      effectiveDate: postBody.effectiveDate,
      expirationDate: postBody.expirationDate,
      ...postBody
    };
    created.push(record);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(record) });
  });

  await page.goto('/');

  // The create form is a deliberate action, not a form permanently occupying the page.
  await expect(page.getByLabel('Contract number')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page.getByRole('heading', { name: 'New assumed contract' })).toBeVisible();

  await page.getByLabel('Contract number').fill('XOL-2026-00042');
  await page.getByLabel('Contract type').selectOption('QUOTA_SHARE');
  await page.getByRole('button', { name: 'Create draft contract' }).click();

  await expect.poll(() => postBody && postBody.contractNumber).toBe('XOL-2026-00042');
  expect(postBody.contractType).toBe('QUOTA_SHARE');

  const registerEntry = page.locator('.eia-record-list button').filter({ hasText: 'XOL-2026-00042' });
  await expect(registerEntry).toBeVisible();
  await expect(registerEntry).toContainText('DRAFT');
  await expect(page.getByLabel('Contract number')).toHaveCount(0);
});
