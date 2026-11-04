import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// The browser downloads Natural Earth from GitHub on a tab's first render. These tests make that
// host fail on purpose, to check the retry (a transient 503) and the message (every try fails).
const ITALY = fileURLToPath(new URL('../../../examples/italy.yaml', import.meta.url))
const NE = /raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\//

test('a transient 503 from GitHub is retried and the render still works', async ({ page }) => {
  let failuresLeft = 1
  await page.route(NE, (route) => {
    if (failuresLeft-- > 0) return route.fulfill({ status: 503, body: 'busy' })
    return route.continue()
  })
  await page.goto('/')
  await page.getByLabel('Open YAML file').setInputFiles(ITALY)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Rendered route map' })).toBeVisible({ timeout: 90_000 })
  expect(failuresLeft).toBeLessThan(0) // the 503 was really served, and the retry got through
})

test('when GitHub keeps failing, the message says what failed and what to do', async ({ page }) => {
  await page.route(NE, (route) => route.fulfill({ status: 503, body: 'busy' }))
  await page.goto('/')
  await page.getByLabel('Open YAML file').setInputFiles(ITALY)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const alert = page.locator('.render-panel [role="alert"]')
  await expect(alert).toContainText('Could not download the ne_10m', { timeout: 90_000 })
  await expect(alert).toContainText('HTTP 503 from raw.githubusercontent.com after 4 attempts')
  await expect(alert).toContainText('githubstatus.com')
})
