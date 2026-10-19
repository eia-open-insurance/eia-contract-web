import { test, expect } from '@playwright/test';

test('renders the contract workbench and a contract row', async ({ page }) => {
  await page.route('**/api/v1/contracts', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '1',
            contractNumber: 'XOL-2025-00091',
            contractType: 'EXCESS_OF_LOSS',
            status: 'DRAFT',
            effectiveDate: '2025-01-01',
            expirationDate: '2025-12-31',
            currency: 'USD'
          }
        ])
      });
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Contract' })).toBeVisible();
  await expect(page.getByText('Assumed reinsurance treaties, facultative placements, and their lifecycle.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'XOL-2025-00091' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DRAFT' })).toBeVisible();
});
