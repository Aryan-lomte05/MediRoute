/**
 * ==============================================================================
 * CITY COMMAND CENTRE (ADMIN) - end-to-end UI
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

test.describe('Admin - shell', () => {
  test('loads and renders live operational content', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/admin$/)
    await page.waitForTimeout(5000) // map + first data poll
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(600)

    expectNoErrors(errors)
  })

  test('shows no fabricated metrics or stale model claims', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(5000)

    const body = page.locator('body')
    await expect(body).not.toContainText('19 Sep 2026')
    // The footer used to assert a specific model was active in static text,
    // naming one that had been decommissioned.
    await expect(body).not.toContainText(/LLaMA-3\.3/i)
    await expect(body).not.toContainText('76 km/h')
  })

  test('reports real AI status rather than asserting it', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(5000)
    await expect(page.getByText(/AI ONLINE|AI DEGRADED/).first()).toBeVisible()
  })

  test('the clock advances', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(2000)

    const clock = page.locator('text=/\\d{2}:\\d{2}:\\d{2}/').first()
    const t1 = await clock.innerText()
    await page.waitForTimeout(2200)
    const t2 = await clock.innerText()
    expect(t2, 'clock is frozen').not.toBe(t1)
  })
})

test.describe('Admin - every view', () => {
  const views = [
    { name: /3d tactical gis/i, expect: /incident|unit|hospital|live/i },
    { name: /fleet operations/i, expect: /MH-AMB|vehicle|fleet/i },
    { name: /trauma & bed matrix/i, expect: /icu|bed|hospital/i },
    { name: /ai predictive surge/i, expect: /forecast|surge|load|confidence/i },
    { name: /incident ledger/i, expect: /inc-|incident|no incidents/i },
  ]

  for (const view of views) {
    test(`opens "${view.name.source}"`, async ({ page }) => {
      const errors = collectErrors(page)
      await page.goto('/admin')
      await page.waitForTimeout(4000)

      await page.getByRole('button', { name: view.name }).click()
      await page.waitForTimeout(1500)
      await expect(page.locator('body')).toContainText(view.expect, { timeout: 15_000 })

      expectNoErrors(errors)
    })
  }
})

test.describe('Admin - forecast honesty', () => {
  test('surge confidence is a sane percentage, not a multiplied value', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: /ai predictive surge/i }).click()
    await page.waitForTimeout(2000)

    const text = await page.locator('body').innerText()
    // The chart previously multiplied an already-0-100 confidence by 100 again,
    // producing labels like 3500%.
    const bogus = text.match(/\b(\d{3,})%/g) || []
    const tooBig = bogus.filter((m) => parseInt(m, 10) > 100)
    expect(tooBig, `impossible percentages rendered: ${tooBig.join(', ')}`).toEqual([])
  })
})

test.describe('Admin - guidance and density', () => {
  test('simple mode hides the specialist views', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(4000)

    await expect(page.getByRole('button', { name: /fleet operations/i })).toBeVisible()

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /simple/i }).click()

    await expect(page.getByRole('button', { name: /fleet operations/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /ai predictive surge/i })).toBeHidden()
    await expect(page.getByText(/live emergencies across the city/i)).toBeVisible()

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /full/i }).click()
    await expect(page.getByRole('button', { name: /fleet operations/i })).toBeVisible()
  })

  test('switching to simple from a hidden view does not strand the screen', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(4000)

    await page.getByRole('button', { name: /ai predictive surge/i }).click()
    await page.waitForTimeout(1200)

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /simple/i }).click()
    await page.waitForTimeout(1200)

    // It must fall back to an allowed view rather than render something
    // unreachable with no tab to return to.
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(400)
    await expect(page.getByText(/live emergencies across the city/i)).toBeVisible()
  })

  test('the walkthrough opens and completes', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForTimeout(4000)

    await page.getByRole('button', { name: 'How to use this screen' }).click()
    await expect(page.getByRole('heading', { name: /whole city at once/i })).toBeVisible()

    for (let i = 0; i < 6; i++) {
      const next = page.getByRole('button', { name: /^next$/i })
      if (!(await next.isVisible().catch(() => false))) break
      await next.click()
    }
    await page.getByRole('button', { name: /got it/i }).click()
    await expect(page.getByRole('button', { name: /got it/i })).toBeHidden()
  })
})
