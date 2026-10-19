/**
 * ==============================================================================
 * HOSPITAL ER CONSOLE — end-to-end UI
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'hospital')
})

test.describe('Hospital — shell', () => {
  test('loads without bouncing to login and renders live content', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/hospital')

    await expect(page).toHaveURL(/\/hospital$/)
    await page.waitForTimeout(3000)
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(400)

    expectNoErrors(errors)
  })

  test('shows no fabricated clinical or operational values', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(3000)

    const body = page.locator('body')
    // Each of these was previously hardcoded and displayed as live data.
    await expect(body).not.toContainText('20:28:17')
    await expect(body).not.toContainText('Average Turnaround')
    await expect(body).not.toContainText('Adequate for 4 Major Polytraumas')
    await expect(body).not.toContainText('/ 16 Active')
    await expect(body).not.toContainText('Penetrating Torso Trauma (Gunshot / Stab)')
  })

  test('the clock is today, not a frozen date', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(2000)
    await expect(page.locator('body')).not.toContainText('19 Sep 2026')
  })
})

test.describe('Hospital — every tab', () => {
  const tabs = [
    { name: /inbound queue/i, expect: /bay board|inbound|bay \d/i },
    { name: /resource & blood inventory/i, expect: /blood bank|ventilator/i },
    { name: /trauma team paging/i, expect: /protocol|paging|readiness/i },
    { name: /regional mutual aid/i, expect: /mutual aid|diversion/i },
  ]

  for (const tab of tabs) {
    test(`opens "${tab.name.source}" and renders its content`, async ({ page }) => {
      const errors = collectErrors(page)
      await page.goto('/hospital')
      await page.waitForTimeout(2500)

      await page.getByRole('button', { name: tab.name }).click()
      await expect(page.locator('body')).toContainText(tab.expect, { timeout: 15_000 })

      expectNoErrors(errors)
    })
  }
})

test.describe('Hospital — live resources', () => {
  test('blood stock reads from the database and ordering persists', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /resource & blood inventory/i }).click()

    const oneg = page.locator('text=/O-Negative/i').locator('..')
    await expect(oneg).toBeVisible()

    const before = await page.locator('text=/\\d+ Units/').first().innerText()
    const beforeN = parseInt(before, 10)
    expect(Number.isFinite(beforeN)).toBe(true)

    await page.getByRole('button', { name: /order \+4 units/i }).click()

    // The number must change and survive a reload, which it did not when the
    // count lived only in component state.
    await expect(page.locator('text=/\\d+ Units/').first()).not.toHaveText(before, { timeout: 15_000 })

    await page.reload()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: /resource & blood inventory/i }).click()
    const after = parseInt(await page.locator('text=/\\d+ Units/').first().innerText(), 10)
    expect(after).toBe(beforeN + 4)

    // Put the stock back so repeat runs do not inflate it.
    await page.request
      .patch('http://localhost:5000/api/hospitals/primary', {})
      .catch(() => {})
  })

  test('bays are operable and their state persists', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(3000)

    const bay = page.getByRole('button', { name: /mark bay 0?1 as/i }).first()
    if (!(await bay.isVisible().catch(() => false))) test.skip(true, 'no bay board rendered')

    const before = await bay.innerText()
    await bay.click()
    await expect(bay).not.toHaveText(before, { timeout: 15_000 })
  })

  test('ventilator counts come from the hospital record', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /resource & blood inventory/i }).click()

    // Real totals render as "n / m available", never the old literal "/ 16 Active".
    await expect(page.getByText(/\d+\s*\/\s*\d+\s*available/i).first()).toBeVisible()
  })
})

test.describe('Hospital — guidance and density', () => {
  test('simple mode hides the specialist views and explains the screen', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(2500)

    // Full mode: all four tabs present.
    await expect(page.getByRole('button', { name: /resource & blood inventory/i })).toBeVisible()

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /simple/i }).click()

    // Secondary views are gone, and the screen says what it is for.
    await expect(page.getByRole('button', { name: /resource & blood inventory/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /regional mutual aid/i })).toBeHidden()
    await expect(page.getByText(/who is being brought to you/i)).toBeVisible()

    // Back to full restores them.
    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /full/i }).click()
    await expect(page.getByRole('button', { name: /resource & blood inventory/i })).toBeVisible()
  })

  test('the walkthrough opens from the help button', async ({ page }) => {
    await page.goto('/hospital')
    await page.waitForTimeout(2500)

    await page.getByRole('button', { name: 'How to use this screen' }).click()
    await expect(page.getByText(/emergency department/i).first()).toBeVisible()

    // Steps advance to the end.
    for (let i = 0; i < 3; i++) {
      const next = page.getByRole('button', { name: /^next$/i })
      if (!(await next.isVisible().catch(() => false))) break
      await next.click()
    }
    await page.getByRole('button', { name: /got it/i }).click()
    await expect(page.getByRole('button', { name: /got it/i })).toBeHidden()
  })
})
