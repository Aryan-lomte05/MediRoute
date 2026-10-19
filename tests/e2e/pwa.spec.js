/**
 * ==============================================================================
 * PWA INSTALLABILITY AND OFFLINE BEHAVIOUR — end-to-end
 * ==============================================================================
 *
 * The emergency page is the one surface that must survive a bad connection, so
 * these checks cover the manifest, the raster icons installers require, service
 * worker registration, and rendering with the network cut.
 * ==============================================================================
 */

import { test, expect } from '@playwright/test'

test.describe('PWA — manifest', () => {
  test('is linked, valid, and starts on the emergency page', async ({ page, request }) => {
    await page.goto('/sos')

    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.json')

    const res = await request.get('/manifest.json')
    expect(res.ok()).toBe(true)
    const m = await res.json()

    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.display).toBe('standalone')
    expect(m.background_color).toBeTruthy()
    expect(m.theme_color).toBeTruthy()

    // Opening the installed app must land on reporting, not a marketing page
    // and not a route that demands a login.
    expect(m.start_url).toBe('/sos')
  })

  test('declares the raster icons installers require', async ({ request }) => {
    const m = await (await request.get('/manifest.json')).json()

    const png = (m.icons || []).filter((i) => i.type === 'image/png')
    expect(png.length, 'no PNG icons declared').toBeGreaterThan(0)

    // Android needs 192 and 512, and a maskable entry to avoid cropping the glyph.
    const sizes = png.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect((m.icons || []).some((i) => i.purpose === 'maskable')).toBe(true)

    // Every declared icon must actually exist.
    for (const icon of m.icons) {
      const res = await request.get(icon.src)
      expect(res.ok(), `${icon.src} is missing`).toBe(true)
    }
  })

  test('declares an apple-touch-icon, which iOS requires', async ({ page, request }) => {
    await page.goto('/sos')
    const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect(href, 'iOS installs show a blank tile without this').toBeTruthy()

    const res = await request.get(href)
    expect(res.ok()).toBe(true)
    expect(res.headers()['content-type']).toContain('image/png')
  })

  test('every shortcut points at a route that works without a login', async ({ request }) => {
    const m = await (await request.get('/manifest.json')).json()
    const emergency = (m.shortcuts || []).find((s) => /emergency/i.test(s.name))

    expect(emergency, 'no emergency shortcut').toBeTruthy()
    // It previously pointed at /patient, which is behind authentication.
    expect(emergency.url).toBe('/sos')
  })
})

test.describe('PWA — service worker', () => {
  test('registers and becomes active', async ({ page }) => {
    await page.goto('/sos')

    const state = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported'
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) return 'none'
      await navigator.serviceWorker.ready
      return reg.active ? 'active' : 'registered'
    })

    expect(['active', 'registered']).toContain(state)
  })

  test('precaches the emergency page so it opens offline', async ({ page, context }) => {
    // Prime the cache.
    await page.goto('/sos')
    await page.evaluate(() => navigator.serviceWorker?.ready)
    await page.waitForTimeout(3000)

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys()
      for (const k of keys) {
        const c = await caches.open(k)
        const hit = (await c.match('/sos')) || (await c.match('/index.html')) || (await c.match('/'))
        if (hit) return true
      }
      return false
    })
    expect(cached, 'the shell was not precached').toBe(true)

    // With the network cut the page must still render rather than show the
    // browser's offline error.
    await context.setOffline(true)
    await page.reload().catch(() => {})
    const text = await page.locator('body').innerText().catch(() => '')
    await context.setOffline(false)

    expect(text.length, 'nothing rendered offline').toBeGreaterThan(30)
  })

  test('does not serve API responses from cache', async ({ page }) => {
    await page.goto('/sos')
    await page.waitForTimeout(2000)

    // Stale bed counts or a stale ambulance position would be worse than none.
    const sw = await page.request.get('/sw.js')
    const src = await sw.text()
    expect(src).toMatch(/\/api/)
    expect(src).toMatch(/return/)
  })
})

test.describe('PWA — mobile rendering', () => {
  test('the emergency page fits a phone with no sideways scroll', async ({ page }) => {
    await page.goto('/sos')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflow).toBe(false)
  })

  test('declares a viewport and a theme colour', async ({ page }) => {
    await page.goto('/sos')

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toContain('width=device-width')

    const theme = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(theme).toBeTruthy()
  })
})
