/**
 * ==============================================================================
 * LANDING PAGE + INTERACTIVE WALKTHROUGH — end-to-end UI
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'
import { collectErrors, expectNoErrors } from './helpers.js'

test.describe('Landing — hero and routing', () => {
  test('renders the hero and the plain-language steps', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/if you need help right now/i)).toBeVisible()

    // The three steps a first-time visitor needs.
    await expect(page.getByText(/no account, no password/i)).toBeVisible()
    await expect(page.getByText(/an ambulance is sent/i)).toBeVisible()

    // It must say plainly that it does not replace calling.
    await expect(page.getByText(/does not replace that/i)).toBeVisible()

    expectNoErrors(errors)
  })

  test('Emergency SOS goes to the public page, not the login wall', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /emergency sos/i }).click()
    await expect(page).toHaveURL(/\/sos$/)
    await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeVisible()
  })

  test('advertises that no login is needed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/no login needed/i)).toBeVisible()
  })

  test('the 108 link is a real tel: link', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('a[href="tel:108"]').first()).toBeVisible()
  })
})

test.describe('Landing — interactive walkthrough', () => {
  test('opens, plays, and exposes every chapter', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/')

    await page.getByRole('button', { name: /watch how it works/i }).click()

    await expect(page.getByText(/how mediroute works/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /what this is/i })).toBeVisible()

    // Transport controls.
    await expect(page.getByRole('button', { name: /^pause$|^play$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next chapter' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous chapter' })).toBeVisible()

    // Every chapter is directly reachable from the chapter list.
    const chapters = [
      /what this is/i,
      /starting a report/i,
      /if it is you/i,
      /if it is someone else/i,
      /how urgency is decided/i,
      /what happens next/i,
      /following the ambulance/i,
      /while you wait/i,
      /the professional side/i,
    ]

    for (const name of chapters) {
      await page.getByRole('button', { name }).last().click()
      await expect(page.getByRole('heading', { name })).toBeVisible()
    }

    expectNoErrors(errors)
  })

  test('pauses and resumes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /watch how it works/i }).click()

    const transport = page.getByRole('button', { name: /^pause$|^play$|^replay$/i })
    await expect(transport).toHaveText(/pause/i)
    await transport.click()
    await expect(transport).toHaveText(/play/i)
    await transport.click()
    await expect(transport).toHaveText(/pause/i)
  })

  test('offers a direct route into the emergency page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /watch how it works/i }).click()
    await page.getByRole('button', { name: /open emergency page/i }).click()
    await expect(page).toHaveURL(/\/sos$/)
  })

  test('closes with the button and with Escape', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: /watch how it works/i }).click()
    await expect(page.getByText(/how mediroute works/i)).toBeVisible()
    await page.getByRole('button', { name: /^close$/i }).click()
    await expect(page.getByText(/how mediroute works/i)).toBeHidden()

    await page.getByRole('button', { name: /watch how it works/i }).click()
    await expect(page.getByText(/how mediroute works/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/how mediroute works/i)).toBeHidden()
  })

  test('captions are real selectable text, not an image', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /watch how it works/i }).click()

    const caption = page.getByText(/connects four people in one emergency/i)
    await expect(caption).toBeVisible()
    expect((await caption.innerText()).length).toBeGreaterThan(40)
  })
})

test.describe('Landing — the rest of the page works', () => {
  test('legal modals open and close', async ({ page }) => {
    await page.goto('/')

    for (const name of [/^privacy$/i, /^terms$/i, /^contact$/i]) {
      const link = page.getByRole('button', { name })
      if (!(await link.isVisible().catch(() => false))) continue
      await link.click()
      const close = page.getByRole('button', { name: '✕' })
      await expect(close).toBeVisible()
      await close.click()
      await expect(close).toBeHidden()
    }
  })

  test('no control on the page is unlabelled', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2500) // let the map and animations settle

    const controls = page.locator('button:visible')
    const count = await controls.count()

    for (let i = 0; i < count; i++) {
      const el = controls.nth(i)
      const text = ((await el.innerText().catch(() => '')) || '').trim()
      const label = (await el.getAttribute('aria-label')) || ''
      const title = (await el.getAttribute('title')) || ''
      expect((text + label + title).length, `button ${i} has no accessible name`).toBeGreaterThan(0)
    }
  })
})
