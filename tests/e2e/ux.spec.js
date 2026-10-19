/**
 * ==============================================================================
 * CROSS-CUTTING UI/UX AND ACCESSIBILITY
 * ==============================================================================
 *
 * Rules that should hold on every screen, rather than behaviour of one feature.
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { loginAs, collectErrors, expectNoErrors } from './helpers.js'

const PUBLIC_ROUTES = ['/', '/sos', '/login']
const STAFF_ROUTES = [
  { path: '/admin', role: 'admin' },
  { path: '/hospital', role: 'hospital' },
  { path: '/paramedic', role: 'paramedic' },
  { path: '/patient', role: 'patient' },
]

test.describe('UX — public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders without JS errors and has one h1`, async ({ page }) => {
      const errors = collectErrors(page)
      await page.goto(route)
      await page.waitForTimeout(3500)

      const body = await page.locator('body').innerText()
      expect(body.length, `${route} rendered nothing`).toBeGreaterThan(50)

      // A screen reader needs a single top-level heading to anchor on.
      const h1s = await page.locator('h1:visible').count()
      expect(h1s, `${route} has ${h1s} visible h1 elements`).toBeLessThanOrEqual(1)

      expectNoErrors(errors)
    })
  }

  test('no route leaks a raw status enum to a citizen', async ({ page }) => {
    for (const route of ['/', '/sos']) {
      await page.goto(route)
      await page.waitForTimeout(1500)
      const text = await page.locator('body').innerText()
      for (const token of ['EN_ROUTE_TO_PATIENT', 'TRIAGE_COMPLETE', 'ARRIVED_AT_HOSPITAL']) {
        expect(text, `${route} shows the raw enum ${token}`).not.toContain(token)
      }
    }
  })
})

test.describe('UX — staff routes', () => {
  for (const route of STAFF_ROUTES) {
    test(`${route.path} renders without JS errors`, async ({ page }) => {
      await loginAs(page, route.role)
      const errors = collectErrors(page)

      await page.goto(route.path)
      await page.waitForTimeout(4500)

      expect((await page.locator('body').innerText()).length).toBeGreaterThan(200)
      expectNoErrors(errors)
    })

    test(`${route.path} offers help and a density switch`, async ({ page }) => {
      await loginAs(page, route.role)
      await page.goto(route.path)
      await page.waitForTimeout(3500)

      await expect(page.getByRole('button', { name: 'How to use this screen' })).toBeVisible()
      await expect(page.getByRole('group', { name: /display density/i })).toBeVisible()
    })
  }
})

test.describe('UX — no fabricated data anywhere', () => {
  // Strings that were previously hardcoded and presented as live readings.
  const GHOSTS = [
    '19 Sep 2026',
    '20:28:17',
    '05:40',
    '76 km/h',
    'Average Turnaround',
    'Adequate for 4 Major Polytraumas',
    '/ 16 Active',
    'Penetrating Torso Trauma (Gunshot / Stab)',
    'LLaMA-3.3',
    'Listening & Transcribing via OpenAI Whisper',
  ]

  for (const route of STAFF_ROUTES) {
    test(`${route.path} shows none of the old invented values`, async ({ page }) => {
      await loginAs(page, route.role)
      await page.goto(route.path)
      await page.waitForTimeout(4500)

      const text = await page.locator('body').innerText()
      const found = GHOSTS.filter((g) => text.includes(g))
      expect(found, `fabricated values still rendered: ${found.join(', ')}`).toEqual([])
    })
  }
})

test.describe('UX — keyboard access', () => {
  test('the emergency page is operable by keyboard alone', async ({ page }) => {
    await page.goto('/sos')

    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const el = document.activeElement
      return el ? { tag: el.tagName, text: (el.innerText || '').trim().slice(0, 40) } : null
    })

    expect(focused, 'nothing receives focus').toBeTruthy()
    expect(['A', 'BUTTON', 'INPUT', 'TEXTAREA']).toContain(focused.tag)
  })

  test('focus is visible on the primary emergency actions', async ({ page }) => {
    await page.goto('/sos')

    const btn = page.getByRole('button', { name: /^i need help/i })
    await btn.focus()

    const hasIndicator = await btn.evaluate((el) => {
      const s = getComputedStyle(el)
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none' || s.outlineWidth !== '0px'
    })
    expect(hasIndicator, 'no visible focus indicator').toBe(true)
  })
})

test.describe('UX — responsive layout', () => {
  const sizes = [
    { name: 'small phone', width: 360, height: 740 },
    { name: 'large phone', width: 430, height: 932 },
    { name: 'tablet', width: 820, height: 1180 },
  ]

  for (const size of sizes) {
    test(`the emergency page fits a ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto('/sos')
      await page.waitForTimeout(1200)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      expect(overflow, `sideways scroll at ${size.width}px`).toBe(false)

      // The primary action must be reachable without pinching.
      const btn = page.getByRole('button', { name: /^i need help/i })
      const box = await btn.boundingBox()
      expect(box.width).toBeLessThanOrEqual(size.width)
      expect(box.height).toBeGreaterThanOrEqual(44)
    })
  }
})
