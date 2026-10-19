/**
 * ==============================================================================
 * SIGNED-IN CITIZEN PORTAL — end-to-end UI
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'patient')
})

test.describe('Patient — shell', () => {
  test('loads and renders', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/patient')

    await expect(page).toHaveURL(/\/patient$/)
    await page.waitForTimeout(3500)
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(300)

    expectNoErrors(errors)
  })

  test('points the citizen at the faster no-login page', async ({ page }) => {
    await page.goto('/patient')
    await page.waitForTimeout(2500)

    const link = page.getByRole('link', { name: /emergency page/i })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/sos$/)
  })
})

test.describe('Patient — every tab', () => {
  const tabs = [
    { name: /sos|emergency/i, expect: /sos|emergency|help/i },
    { name: /track/i, expect: /track|ambulance|status|no active/i },
    { name: /first aid|firstaid/i, expect: /cpr|bleeding|choking|first aid/i },
    { name: /profile/i, expect: /blood|allerg|profile|contact/i },
  ]

  for (const tab of tabs) {
    test(`opens the "${tab.name.source}" tab`, async ({ page }) => {
      const errors = collectErrors(page)
      await page.goto('/patient')
      await page.waitForTimeout(3000)

      const btn = page.getByRole('button', { name: tab.name }).first()
      if (!(await btn.isVisible().catch(() => false))) test.skip(true, 'tab not present')

      await btn.click()
      await page.waitForTimeout(1200)
      await expect(page.locator('body')).toContainText(tab.expect, { timeout: 15_000 })

      expectNoErrors(errors)
    })
  }
})

test.describe('Patient — guidance and density', () => {
  test('simple mode keeps SOS and tracking only', async ({ page }) => {
    await page.goto('/patient')
    await page.waitForTimeout(3000)

    const density = page.getByRole('group', { name: /display density/i })
    await density.getByRole('button', { name: /simple/i }).click()

    await expect(page.getByText(/use the red button to call for help/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /first aid|firstaid/i }).first()).toBeHidden()

    await density.getByRole('button', { name: /full/i }).click()
    await expect(page.getByRole('button', { name: /first aid|firstaid/i }).first()).toBeVisible()
  })

  test('the walkthrough explains that no account is needed for emergencies', async ({ page }) => {
    await page.goto('/patient')
    await page.waitForTimeout(3000)

    await page.getByRole('button', { name: 'How to use this screen' }).click()
    await expect(page.getByRole('heading', { name: /do not need to be signed in/i })).toBeVisible()
    await page.getByRole('button', { name: /skip/i }).click()
  })
})
