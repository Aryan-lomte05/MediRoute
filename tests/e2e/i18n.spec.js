/**
 * ==============================================================================
 * LANGUAGE SUPPORT - end-to-end UI
 * ==============================================================================
 *
 * The people most likely to need this product are the least likely to read
 * English comfortably, so the emergency page in particular has to work in the
 * reader's own language. These checks assert that the choice is reachable
 * everywhere, that it actually changes the words, and that it survives a
 * reload.
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

/** Pick a language through the header control. */
async function chooseLanguage(page, code) {
  const select = page.locator('select[aria-label="Choose language"]').first()
  await expect(select).toBeVisible()
  await select.selectOption(code)
  await page.waitForTimeout(600)
}

test.describe('Language - the emergency page', () => {
  test('offers a language choice', async ({ page }) => {
    await page.goto('/sos')
    await expect(page.locator('select[aria-label="Choose language"]').first()).toBeVisible()
  })

  test('translates the entry screen into Hindi', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/sos')

    await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeVisible()

    await chooseLanguage(page, 'hi')

    // The heading and both branch buttons must change, not just one label.
    await expect(page.getByText('आपातकालीन मदद पाएँ')).toBeVisible()
    await expect(page.getByText('मुझे मदद चाहिए')).toBeVisible()
    await expect(page.getByText('किसी और को मदद चाहिए')).toBeVisible()

    // And the English must be gone, so nothing is half-translated.
    await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeHidden()

    expectNoErrors(errors)
  })

  test('translates into Marathi', async ({ page }) => {
    await page.goto('/sos')
    await chooseLanguage(page, 'mr')
    await expect(page.getByText('आपत्कालीन मदत मिळवा')).toBeVisible()
    await expect(page.getByText('मला मदत हवी आहे')).toBeVisible()
  })

  test('translates the questions, not only the first screen', async ({ page }) => {
    await page.goto('/sos')
    await chooseLanguage(page, 'hi')

    await page.getByText('किसी और को मदद चाहिए').click()
    await page.waitForTimeout(800)

    // Bystander questions and the complaint catalogue.
    await expect(page.getByText('क्या व्यक्ति होश में है?')).toBeVisible()
    await expect(page.getByText('क्या उनकी साँस चल रही है?')).toBeVisible()
    await expect(page.getByText('सड़क दुर्घटना')).toBeVisible()
  })

  test('remembers the choice across a reload', async ({ page }) => {
    await page.goto('/sos')
    await chooseLanguage(page, 'hi')
    await expect(page.getByText('आपातकालीन मदद पाएँ')).toBeVisible()

    await page.reload()
    await page.waitForTimeout(1500)

    // Still Hindi: the preference is stored per device.
    await expect(page.getByText('आपातकालीन मदद पाएँ')).toBeVisible()
  })

  test('sets the document language, which screen readers rely on', async ({ page }) => {
    await page.goto('/sos')
    await chooseLanguage(page, 'mr')
    await expect(page.locator('html')).toHaveAttribute('lang', 'mr')
  })

  test('still has no sideways scroll in a longer script', async ({ page }) => {
    await page.goto('/sos')
    await chooseLanguage(page, 'hi')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflow, 'translated text pushes the page sideways').toBe(false)
  })
})

test.describe('Language - every other page', () => {
  test('the landing page offers it', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)
    await expect(page.locator('select[aria-label="Choose language"]').first()).toBeVisible()
  })

  test('the login page offers it', async ({ page }) => {
    await page.goto('/login')
    await page.waitForTimeout(2500)
    await expect(page.locator('select[aria-label="Choose language"]').first()).toBeVisible()
  })

  const portals = [
    { path: '/admin', role: 'admin' },
    { path: '/hospital', role: 'hospital' },
    { path: '/paramedic', role: 'paramedic' },
    { path: '/patient', role: 'patient' },
  ]

  for (const p of portals) {
    test(`${p.path} offers it`, async ({ page }) => {
      await loginAs(page, p.role)
      await page.goto(p.path)
      await page.waitForTimeout(4000)
      await expect(page.locator('select[aria-label="Choose language"]').first()).toBeVisible()
    })
  }
})
