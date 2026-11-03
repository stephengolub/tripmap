import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Starts from Open YAML rather than a live draft, so it needs neither Photos
// nor the draft's network calls.
const ITALY = fileURLToPath(new URL('../../examples/italy.yaml', import.meta.url))

test('open Italy, see it on the map and in the legs, render it', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Open YAML file').setInputFiles(ITALY)

  // Map markers for the visible stops (Bologna, Rome, Florence).
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible()
  expect(await page.locator('.leaflet-marker-icon').count()).toBeGreaterThanOrEqual(3)

  // The Italy legs, including the two train days.
  const legs = page.getByRole('region', { name: 'Legs' }).getByRole('listitem').filter({ has: page.locator('.leg-card-date') })
  expect(await legs.count()).toBeGreaterThanOrEqual(5)
  for (const date of ['2024-05-02', '2024-05-03', '2024-05-05', '2024-05-07', '2024-05-08']) {
    await expect(page.locator('.leg-card-date', { hasText: date }).first()).toBeVisible()
  }
  await expect(page.getByLabel('Leg 3 mode')).toHaveValue('train')

  // Render needs Chrome on the backend; the image arrives as an object URL.
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const img = page.getByRole('img', { name: 'Rendered route map' })
  await expect(img).toBeVisible({ timeout: 90_000 })
  expect(await img.getAttribute('src')).toMatch(/^blob:/)
})
