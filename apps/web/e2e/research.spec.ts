import { expect, test, type Page } from '@playwright/test';

async function reviewManual(page: Page) {
  await page.goto('/check?new=1');
  await page.getByRole('button', { name: 'Manual input' }).click();
  await page
    .getByLabel('Property title')
    .fill('Garden office for monthly rent');
  await page.getByLabel('Location', { exact: true }).fill('Bangkok');
  await page.getByText('Listing description', { exact: true }).click();
  await page
    .getByLabel('Description', { exact: true })
    .fill(
      'Commercial office for rent in Bangkok, 60 sqm. Monthly rent THB 18000. This is manually entered information.',
    );
  await page.getByRole('button', { name: 'Review details' }).click();
  await expect(
    page.getByRole('switch', { name: /Deep Research/i }),
  ).toBeVisible();
}
test('manual workflow: default off, opt-in report, back persistence, standard mode', async ({
  page,
}) => {
  await reviewManual(page);
  const toggle = page.getByRole('switch', { name: /Deep Research/i });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/api/analyze') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Continue to analysis' }).click();
  expect((await request).postDataJSON().deepResearch).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Your verification review' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Other advertisements discovered' }),
  ).toBeVisible();
  await expect(page.getByText('Research unavailable')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Continue to analysis' }).click();
  await expect(page).toHaveURL(/results/);
  await expect(
    page.getByRole('heading', { name: 'Other advertisements discovered' }),
  ).toHaveCount(0);
});
test('fresh listing resets Deep Research', async ({ page }) => {
  await reviewManual(page);
  await page.getByRole('switch', { name: /Deep Research/i }).check();
  await page.goto('/check?new=1');
  await page.getByRole('button', { name: 'Manual input' }).click();
  await page.getByLabel('Property title').fill('New villa for rent');
  await page.getByRole('button', { name: 'Review details' }).click();
  await expect(
    page.getByRole('switch', { name: /Deep Research/i }),
  ).not.toBeChecked();
});
