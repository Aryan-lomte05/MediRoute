/**
 * Shared helpers for the MediRoute end-to-end UI tests.
 */

import { expect } from '@playwright/test'

export const API = process.env.MEDIROUTE_API || 'http://localhost:5000/api'
export const EMERGENCY_NUMBER = '108'

/**
 * Written into the optional phone field by every test that files a report.
 *
 * Reports created through the UI carry a real geocoded address, so they are
 * otherwise indistinguishable from genuine ones. This gives setup and teardown
 * something precise to clean up, which matters because an open incident holds
 * an ambulance and the fleet is only four vehicles.
 */
export const TEST_PHONE = '+91 00000 00000'

export const ROLES = {
  admin: { email: 'admin@mediroute.com', password: 'admin123', role: 'admin', path: '/admin' },
  paramedic: { email: 'paramedic@mediroute.com', password: 'paramedic123', role: 'paramedic', path: '/paramedic' },
  hospital: { email: 'hospital@mediroute.com', password: 'hospital123', role: 'hospital_staff', path: '/hospital' },
  patient: { email: 'patient@mediroute.com', password: 'patient123', role: 'patient', path: '/patient' },
}

/**
 * Sign in through the API and seed the persisted store, rather than driving the
 * login form for every spec.
 *
 * /api/auth is limited to 20 attempts per 15 minutes, so a token is cached per
 * role for the whole run - otherwise a full suite exhausts the limiter and
 * every later spec fails for a reason that has nothing to do with the UI.
 */
const tokenCache = new Map()

export async function loginAs(page, roleKey, { skipTours = true } = {}) {
  const role = ROLES[roleKey]
  if (!role) throw new Error(`Unknown role: ${roleKey}`)

  if (!tokenCache.has(roleKey)) {
    const res = await page.request.post(`${API}/auth/login`, {
      data: { email: role.email, password: role.password, role: role.role },
    })
    const body = await res.json()
    if (!res.ok() || !body.token) {
      throw new Error(`Login failed for ${roleKey}: ${res.status()} ${JSON.stringify(body).slice(0, 160)}`)
    }
    tokenCache.set(roleKey, body)
  }

  const { token, user } = tokenCache.get(roleKey)

  // The store must exist before the app boots, or ProtectedRoute redirects.
  await page.addInitScript(
    ([t, u, skip]) => {
      localStorage.setItem('mediroute-auth', JSON.stringify({ state: { token: t, user: u }, version: 0 }))
      if (skip) {
        localStorage.setItem(
          'mediroute-ui',
          JSON.stringify({
            state: {
              modes: {},
              completedTours: {
                'admin-v1': 'done',
                'hospital-v1': 'done',
                'paramedic-v1': 'done',
                'patient-v1': 'done',
              },
              explainJargon: true,
            },
            version: 0,
          })
        )
      }
    },
    [token, user, skipTours]
  )

  return { token, user }
}

/** Collect uncaught page errors and console errors for an assertion later. */
export function collectErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // Noise that is not the app's fault: missing dev-only assets, aborted map
    // tiles, socket retries against a server the test did not start.
    if (/favicon|manifest\.json|sw\.js|DevTools|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text)) return
    if (/websocket|socket\.io|mapbox|WebGL|AbortError/i.test(text)) return
    errors.push(`console: ${text}`)
  })
  return errors
}

/** Assert no page-level JS errors were collected. */
export function expectNoErrors(errors) {
  expect(errors, `Unexpected JS errors:\n${errors.join('\n')}`).toEqual([])
}

/**
 * Walk the SOS flow up to the confirm screen.
 *
 * @param {'SELF'|'BYSTANDER'} branch
 */
export async function fillSosUpToConfirm(page, branch = 'BYSTANDER') {
  await page.goto('/sos')

  await expect(page.getByRole('heading', { name: /get emergency help/i })).toBeVisible()

  if (branch === 'BYSTANDER') {
    await page.getByRole('button', { name: /someone else needs help/i }).click()
    await expect(page.getByRole('heading', { name: /what has happened/i })).toBeVisible()
    await page.getByRole('button', { name: /road accident/i }).click()

    // Scene questions, by their legend rather than by position.
    const awake = page.locator('fieldset', { hasText: /is the person awake/i })
    await awake.getByRole('button', { name: 'No', exact: true }).click()

    const breathing = page.locator('fieldset', { hasText: /are they breathing/i })
    await breathing.getByRole('button', { name: 'Yes', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /^i need help/i }).click()
    await expect(page.getByRole('heading', { name: /what's wrong/i })).toBeVisible()
    await page.getByRole('button', { name: /chest pain/i }).click()
  }

  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(page.getByRole('heading', { name: /where should we send help/i })).toBeVisible()

  // Tag the report so teardown can find and close it.
  const phone = page.getByLabel(/your phone number/i)
  if (await phone.isVisible().catch(() => false)) await phone.fill(TEST_PHONE)
}

/**
 * Remove the incidents a spec created, so the suite does not accumulate rows or
 * hold ambulances. Safe to call with an empty list.
 */
export async function cleanupIncidents(request, ids) {
  for (const id of ids.filter(Boolean)) {
    await request.patch(`${API}/incidents/${id}/status`, {
      data: { status: 'CANCELLED' },
      headers: { 'x-tracking-token': id.token || '' },
    }).catch(() => {})
  }
}

/** Every interactive control on screen, for sweep-style tests. */
export async function allClickable(page) {
  return page.locator('button:visible, a[href]:visible, [role="button"]:visible')
}
