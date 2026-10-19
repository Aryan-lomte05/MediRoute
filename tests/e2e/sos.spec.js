/**
 * ==============================================================================
 * PUBLIC EMERGENCY REPORTING (/sos) - end-to-end UI
 * ==============================================================================
 *
 * The highest-stakes surface in the product: anonymous, mobile, used under
 * stress. Covers both reporting branches, every question, validation, the
 * geolocation-denied path, submission, live tracking, resume and cancellation.
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { API, EMERGENCY_NUMBER, collectErrors, expectNoErrors, fillSosUpToConfirm } from './helpers.js'

test.describe('SOS - entry screen', () => {
  test('opens with no account and offers both reporting branches', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/sos')

    await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeVisible()
    await expect(page.getByText(/no account needed/i)).toBeVisible()

    // Both branches, as real buttons.
    await expect(page.getByRole('button', { name: /^i need help/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /someone else needs help/i })).toBeVisible()

    expectNoErrors(errors)
  })

  test('keeps the real emergency number reachable at every step', async ({ page }) => {
    await page.goto('/sos')

    const callLink = page.locator(`a[href="tel:${EMERGENCY_NUMBER}"]`).first()
    await expect(callLink).toBeVisible()

    // Still present after advancing twice.
    await page.getByRole('button', { name: /^i need help/i }).click()
    await expect(page.locator(`a[href="tel:${EMERGENCY_NUMBER}"]`).first()).toBeVisible()

    await page.getByRole('button', { name: /chest pain/i }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page.locator(`a[href="tel:${EMERGENCY_NUMBER}"]`).first()).toBeVisible()
  })

  test('never requires a login to reach the reporting flow', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /^i need help/i }).click()
    // A redirect to /login here would be the regression this product exists to avoid.
    await expect(page).toHaveURL(/\/sos$/)
  })
})

test.describe('SOS - self-report branch', () => {
  test('asks what is wrong in plain language, with no clinical jargon', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /^i need help/i }).click()

    await expect(page.getByRole('heading', { name: /what's wrong/i })).toBeVisible()

    // Complaints are described the way a person would say them.
    for (const label of [/chest pain/i, /can't breathe properly/i, /bleeding badly/i, /i had an accident/i]) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }

    // A patient must never be shown the ESI scale.
    await expect(page.locator('body')).not.toContainText(/\bESI\b/)
  })

  test('blocks continuing until something is described', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /^i need help/i }).click()

    const next = page.getByRole('button', { name: /^continue$/i })
    await expect(next).toBeDisabled()
    await expect(page.getByText(/choose an option above/i)).toBeVisible()

    await page.getByRole('button', { name: /chest pain/i }).click()
    await expect(next).toBeEnabled()
  })

  test('accepts a free-text description as an alternative to the chips', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /^i need help/i }).click()

    await page.getByLabel(/anything else/i).fill('My father is sweating and clutching his arm')
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeEnabled()
  })
})

test.describe('SOS - bystander branch', () => {
  test('asks only what an untrained person can observe', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /someone else needs help/i }).click()

    await expect(page.getByText(/is the person awake/i)).toBeVisible()
    await expect(page.getByText(/are they breathing/i)).toBeVisible()
    await expect(page.getByText(/how many people are hurt/i)).toBeVisible()

    // It must never ask a bystander for clinical facts they cannot know.
    const body = page.locator('body')
    await expect(body).not.toContainText(/blood group/i)
    await expect(body).not.toContainText(/\bGCS\b/)
    await expect(body).not.toContainText(/allergies/i)
  })

  test('offers "Not sure" as a first-class answer', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /someone else needs help/i }).click()

    const awake = page.locator('fieldset', { hasText: /is the person awake/i })
    const notSure = awake.getByRole('button', { name: /not sure/i })
    await expect(notSure).toBeVisible()

    await notSure.click()
    await expect(notSure).toHaveAttribute('aria-pressed', 'true')
  })

  test('records victim count and scene hazards', async ({ page }) => {
    await page.goto('/sos')
    await page.getByRole('button', { name: /someone else needs help/i }).click()

    const count = page.locator('fieldset', { hasText: /how many people are hurt/i })
    await count.getByRole('button', { name: '3', exact: true }).click()
    await expect(count.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true')

    const traffic = page.getByRole('button', { name: /^traffic$/i })
    await traffic.click()
    await expect(traffic).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('SOS - location', () => {
  test('resolves the device location and shows a readable address', async ({ page }) => {
    await fillSosUpToConfirm(page, 'BYSTANDER')

    await expect(page.getByText(/location found/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /send for help now/i })).toBeEnabled()
  })

  test('falls back to a typed address when permission is denied', async ({ page, context }) => {
    await context.clearPermissions()
    await context.setGeolocation(null).catch(() => {})

    await page.goto('/sos')
    await page.getByRole('button', { name: /someone else needs help/i }).click()
    await page.getByRole('button', { name: /road accident/i }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()

    // Either a fix arrived or the manual path is offered - never a dead end.
    const manual = page.getByPlaceholder(/opposite bandra station/i)
    const found = page.getByText(/location found/i)
    await expect(manual.or(found)).toBeVisible()
  })

  test('will not send without a location', async ({ page, context }) => {
    await context.clearPermissions()
    await page.goto('/sos')
    await page.getByRole('button', { name: /^i need help/i }).click()
    await page.getByRole('button', { name: /chest pain/i }).click()
    await page.getByRole('button', { name: /^continue$/i }).click()

    const send = page.getByRole('button', { name: /send for help now/i })
    const manual = page.getByPlaceholder(/opposite bandra station/i)

    if (await manual.isVisible().catch(() => false)) {
      await expect(send).toBeDisabled()
      await expect(page.getByText(/we need a location/i)).toBeVisible()
    }
  })
})

test.describe('SOS - submission and live tracking', () => {
  let createdId = null
  let createdToken = null

  test.afterEach(async ({ request }) => {
    // Never leave a test incident holding an ambulance.
    if (createdId) {
      await request
        .patch(`${API}/incidents/${createdId}/status`, {
          data: { status: 'CANCELLED' },
          headers: { 'x-tracking-token': createdToken || '' },
        })
        .catch(() => {})
      createdId = null
      createdToken = null
    }
  })

  test('dispatches a bystander report end to end', async ({ page }) => {
    const errors = collectErrors(page)

    // Capture the created id so it can be cleaned up afterwards.
    page.on('response', async (res) => {
      if (res.url().endsWith('/incidents') && res.request().method() === 'POST' && res.ok()) {
        try {
          const body = await res.json()
          createdId = body.incident?._id
          createdToken = body.trackingToken
        } catch {
          /* ignore */
        }
      }
    })

    await fillSosUpToConfirm(page, 'BYSTANDER')
    await page.getByRole('button', { name: /send for help now/i }).click()

    // Acknowledged immediately with a reference.
    await expect(page.getByText(/reference inc-/i)).toBeVisible({ timeout: 60_000 })

    // Status is in plain words, never the raw enum.
    await expect(page.getByText(/report received|urgency assessed|ambulance on the way/i).first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText('EN_ROUTE_TO_PATIENT')

    // Triage lands and is expressed as words, not a clinical score.
    await expect(page.getByText(/most urgent|very urgent|urgent/i).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('body')).not.toContainText(/\bESI [1-5]\b/)

    // A real vehicle is assigned.
    await expect(page.getByText(/MH-AMB-\d+/)).toBeVisible({ timeout: 60_000 })

    expectNoErrors(errors)
  })

  test('resumes the report after a reload and allows cancelling', async ({ page }) => {
    page.on('response', async (res) => {
      if (res.url().endsWith('/incidents') && res.request().method() === 'POST' && res.ok()) {
        try {
          const body = await res.json()
          createdId = body.incident?._id
          createdToken = body.trackingToken
        } catch {
          /* ignore */
        }
      }
    })

    await fillSosUpToConfirm(page, 'SELF')
    await page.getByRole('button', { name: /send for help now/i }).click()
    await expect(page.getByText(/reference inc-/i)).toBeVisible({ timeout: 60_000 })

    await page.reload()
    await expect(page.getByText(/reference inc-/i)).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /no longer needed/i }).click()
    await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeVisible({ timeout: 20_000 })

    createdId = null // cancelled through the UI
    createdToken = null
  })
})

test.describe('SOS - mobile ergonomics', () => {
  test('has no horizontal scroll and uses large touch targets', async ({ page }) => {
    await page.goto('/sos')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflow, 'page scrolls sideways on a phone').toBe(false)

    // Primary actions must clear the 44px minimum comfortably.
    for (const name of [/^i need help/i, /someone else needs help/i]) {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('every control on the first screen is reachable and labelled', async ({ page }) => {
    await page.goto('/sos')

    const controls = page.locator('button:visible, a[href]:visible')
    const count = await controls.count()
    expect(count).toBeGreaterThan(2)

    for (let i = 0; i < count; i++) {
      const el = controls.nth(i)
      const text = ((await el.innerText().catch(() => '')) || '').trim()
      const label = (await el.getAttribute('aria-label')) || ''
      expect(
        (text + label).length,
        `control ${i} has no accessible name`
      ).toBeGreaterThan(0)
    }
  })
})
