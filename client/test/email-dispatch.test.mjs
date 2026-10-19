import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchEmergencyEmail } from '../src/lib/emailDispatch.mjs'

const configured = { serviceId: 'service', templateId: 'template', publicKey: 'public' }

test('EmailJS configuration gaps return failure without calling the SDK', async () => {
  let called = false
  const result = await dispatchEmergencyEmail({ send: async () => { called = true } }, configured, '', {})
  assert.equal(result.success, false)
  assert.match(result.error, /not configured/i)
  assert.equal(called, false)
})

test('EmailJS success reflects an accepted SDK response', async () => {
  const result = await dispatchEmergencyEmail({ send: async () => ({ status: 200 }) }, configured, 'team@example.test', {})
  assert.deepEqual(result, { success: true, status: 200 })
})

test('EmailJS rejection remains a failure', async () => {
  const result = await dispatchEmergencyEmail({ send: async () => { throw new Error('request rejected') } }, configured, 'team@example.test', {})
  assert.deepEqual(result, { success: false, error: 'request rejected' })
})
