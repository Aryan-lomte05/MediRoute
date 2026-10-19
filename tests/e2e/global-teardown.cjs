/**
 * Leave the database as the run found it: close test incidents and release the
 * ambulances they were holding.
 */
const cleanTestState = require('./global-setup.cjs')

module.exports = async function globalTeardown() {
  await cleanTestState('teardown')
}
