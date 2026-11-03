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

test('a page refresh brings back the open trip, its filename and its edits', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Open YAML file').setInputFiles(ITALY)
  await expect(page.getByTestId('file-name')).toHaveText(/italy\.yaml/)

  // Rename Bologna in the stop list: an unsaved edit that must survive a reload.
  const bologna = page.getByRole('region', { name: 'Stops' }).getByRole('textbox', { name: 'Name of Bologna', exact: true })
  await bologna.fill('Bologna Centrale')
  await bologna.press('Enter')
  await expect(page.getByTestId('file-name')).toContainText('(unsaved changes)')

  await page.reload()
  await expect(page.getByTestId('file-name')).toHaveText(/italy\.yaml/)
  await expect(page.getByTestId('file-name')).toContainText('(unsaved changes)')
  await expect(page.getByRole('region', { name: 'Stops' }).getByRole('textbox', { name: 'Name of Bologna Centrale', exact: true })).toBeVisible()
})

test('Reframe brings every remaining marker back into view after a stop is removed', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Open YAML file').setInputFiles(ITALY)
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible()

  // Rome is used by the May 3 and May 5 legs, and the reducer refuses to remove a stop a leg
  // still uses. Remove those two legs (leg 2 renumbers to leg 2 again after the first removal),
  // then Rome itself, then reframe.
  await page.getByRole('button', { name: 'Remove leg 2', exact: true }).click()
  await page.getByRole('button', { name: 'Remove leg 2', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Rome', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Stops' }).getByRole('listitem', { name: 'Rome' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reframe map' }).click()
  await page.waitForTimeout(600) // let Leaflet's fitBounds animation finish

  // Without a refit the view still shows Rome's area, so the two remaining stops would
  // fill well under half the map's height. A refit fits them to the map.
  const container = (await page.locator('.trip-map-canvas').boundingBox())!
  const markers = page.locator('.leaflet-marker-icon')
  expect(await markers.count()).toBeGreaterThanOrEqual(2)
  let top = Infinity
  let bottom = -Infinity
  for (let i = 0; i < (await markers.count()); i++) {
    const box = (await markers.nth(i).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(container.x)
    expect(box.y).toBeGreaterThanOrEqual(container.y)
    expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width)
    expect(box.y + box.height).toBeLessThanOrEqual(container.y + container.height)
    top = Math.min(top, box.y)
    bottom = Math.max(bottom, box.y + box.height)
  }
  expect((bottom - top) / container.height).toBeGreaterThan(0.6)
})
