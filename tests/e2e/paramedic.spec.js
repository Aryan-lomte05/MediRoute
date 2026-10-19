/**
 * ==============================================================================
 * PARAMEDIC FIELD CONSOLE — end-to-end UI
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'paramedic')
})

test.describe('Paramedic — shell', () => {
  test('loads and renders', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/paramedic')

    await expect(page).toHaveURL(/\/paramedic$/)
    await page.waitForTimeout(4000)
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(300)

    expectNoErrors(errors)
  })

  test('shows no frozen telemetry', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(4000)

    const body = page.locator('body')
    // The HUD used to display these fixed values as live navigation data.
    await expect(body).not.toContainText('05:40')
    await expect(body).not.toContainText('76 km/h')
    await expect(body).not.toContainText('Thu, 19 Sep 2026')
    // It also named a hospital and bay even with nothing allocated.
    await expect(body).not.toContainText('Lilavati Hospital & Research Centre')
  })

  test('states honestly when there is no GPS or no assignment', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(4000)

    const text = await page.locator('body').innerText()
    // Either real telemetry, or an explicit absence — never an invented number.
    const honest = /no GPS|stationary|--|No unit assigned|No hospital allocated|\d+ km\/h/.test(text)
    expect(honest, 'HUD shows neither real telemetry nor an explicit absence').toBe(true)
  })
})

test.describe('Paramedic — every tab', () => {
  const tabs = [
    { name: /nav|navigation|geonav|3d/i, expect: /eta|destination|distance/i },
    { name: /vitals/i, expect: /heart|spo2|bp|vitals/i },
    { name: /protocol/i, expect: /protocol|checklist|intervention|appear here/i },
    { name: /voice|dictation/i, expect: /dictat|transcri|note/i },
  ]

  for (const tab of tabs) {
    test(`opens the "${tab.name.source}" tab`, async ({ page }) => {
      const errors = collectErrors(page)
      await page.goto('/paramedic')
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

test.describe('Paramedic — checklists and notes are per patient', () => {
  test('the intervention list explains itself when no patient is assigned', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(3000)

    const btn = page.getByRole('button', { name: /protocol/i }).first()
    if (!(await btn.isVisible().catch(() => false))) test.skip(true, 'protocols tab not present')
    await btn.click()

    const text = await page.locator('body').innerText()
    // Either real per-patient items, or a clear explanation — never the old
    // fixed four-item list that was identical for every call.
    const ok = /appear here once a patient|administer|apply|control|notify|hand over/i.test(text)
    expect(ok).toBe(true)
  })

  test('dictation control is honest about what it does', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(3000)

    const btn = page.getByRole('button', { name: /voice|dictation/i }).first()
    if (!(await btn.isVisible().catch(() => false))) test.skip(true, 'voice tab not present')
    await btn.click()

    // The old label claimed transcription was happening while nothing was recorded.
    await expect(page.getByText(/tap to dictate a note/i)).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/Listening & Transcribing via OpenAI Whisper/i)
  })
})

test.describe('Paramedic — guidance and density', () => {
  test('simple mode keeps navigation and vitals only', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(3000)

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /simple/i }).click()

    await expect(page.getByText(/where you are going/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /voice|dictation/i }).first()).toBeHidden()

    await page.getByRole('group', { name: /display density/i }).getByRole('button', { name: /full/i }).click()
    await expect(page.getByRole('button', { name: /voice|dictation/i }).first()).toBeVisible()
  })

  test('the walkthrough opens', async ({ page }) => {
    await page.goto('/paramedic')
    await page.waitForTimeout(3000)

    await page.getByRole('button', { name: 'How to use this screen' }).click()
    await expect(page.getByRole('heading', { name: /navigation runs off this device/i })).toBeVisible()
    await page.getByRole('button', { name: /skip/i }).click()
  })
})
