/**
 * Browser-level smoke test of the three staff portals and the landing page.
 *
 * Signs in as each role by seeding the auth store the way the real login does,
 * loads the portal, and checks that the live-data rewiring renders without
 * runtime errors and without the fabricated values that used to be displayed.
 *
 * Run:  node portal-test.cjs <appUrl> <apiUrl>
 */

const WebSocket = require(require.resolve('ws', {
  paths: [String.raw`E:\Personal or College Projects\Mediroute\client\node_modules`],
}))
const http = require('http')

const APP = process.argv[2] || 'http://localhost:4173'
const API = process.argv[3] || 'http://localhost:5000/api'
const DEBUG_PORT = 9222

let pass = 0
let fail = 0
const ok = (m) => {
  pass++
  console.log('  PASS  ' + m)
}
const bad = (m, d) => {
  fail++
  console.log('  FAIL  ' + m + (d ? '  -- ' + String(d).slice(0, 220) : ''))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: DEBUG_PORT, path }, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(b))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = JSON.stringify(body)
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(b))
          } catch (e) {
            reject(new Error(b.slice(0, 200)))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.errors = []
    ws.on('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(
          m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || 'exception'
        )
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '))
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('timeout ' + method))
        }
      }, 30000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
}

/** Seed the persisted zustand auth store exactly as a real login would. */
const seedAuth = (token, user) => `
(() => {
  localStorage.setItem('mediroute-auth', JSON.stringify({
    state: { token: ${JSON.stringify(token)}, user: ${JSON.stringify(user)} },
    version: 0
  }));
  // Mark every walkthrough complete so the first-visit overlay does not sit
  // over the portal we are trying to inspect.
  localStorage.setItem('mediroute-ui', JSON.stringify({
    state: {
      modes: {},
      completedTours: { 'admin-v1': 'x', 'hospital-v1': 'x', 'paramedic-v1': 'x', 'patient-v1': 'x' },
      explainJargon: true
    },
    version: 0
  }));
  return 'seeded';
})()
`

async function main() {
  const targets = await getJSON('/json/list')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Browser.grantPermissions', { origin: APP, permissions: ['geolocation'] })
  await cdp.send('Emulation.setGeolocationOverride', { latitude: 19.07, longitude: 72.86, accuracy: 20 })

  // ── Landing page ─────────────────────────────────────────────────────────
  console.log('\n=============================================')
  console.log(' LANDING PAGE')
  console.log('=============================================')
  await cdp.send('Page.navigate', { url: APP + '/' })
  await sleep(6000)
  let t = await cdp.eval('document.body.innerText')

  // The heading carries a CSS uppercase transform, which innerText reflects.
  if (/if you need help right now/i.test(t)) ok('plain-language steps present')
  else bad('plain-language steps', t.slice(0, 150))
  if (t.includes('No login needed')) ok('SOS button states no login needed')
  else bad('SOS no-login label')
  if (t.includes('Watch how it works')) ok('walkthrough entry point present')
  else bad('walkthrough entry point')

  // The hero SOS control must target /sos, not /login.
  const sosTarget = await cdp.eval(`
  (() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').includes('Emergency SOS'));
    if (!b) return 'NO_BUTTON';
    b.click();
    return location.pathname;
  })()
  `)
  await sleep(1500)
  const landed = await cdp.eval('location.pathname')
  if (landed === '/sos') ok('Emergency SOS routes to /sos (not /login)')
  else bad('Emergency SOS destination', landed + ' (click returned ' + sosTarget + ')')

  // ── Product tour ─────────────────────────────────────────────────────────
  await cdp.send('Page.navigate', { url: APP + '/' })
  await sleep(6000)
  const tourOpened = await cdp.eval(`
  (() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').includes('Watch how it works'));
    if (!b) return 'NO_BUTTON';
    b.click();
    return 'clicked';
  })()
  `)
  await sleep(1800)
  t = await cdp.eval('document.body.innerText')
  if (tourOpened === 'clicked' && /how mediroute works/i.test(t)) ok('walkthrough opens')
  else bad('walkthrough opens', tourOpened + ' / ' + t.slice(0, 120))
  if (t.includes('Pause') || t.includes('Play')) ok('walkthrough has transport controls')
  else bad('walkthrough controls')
  if (t.includes('Open emergency page')) ok('walkthrough offers the emergency page')
  else bad('walkthrough CTA')

  // Advance a chapter to prove the script progresses.
  await cdp.eval(`
  (() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '→');
    if (b) b.click();
    return 'ok';
  })()
  `)
  await sleep(1200)
  t = await cdp.eval('document.body.innerText')
  if (t.includes('Starting a report') || t.includes('two buttons')) ok('walkthrough advances between chapters')
  else bad('walkthrough advance', t.slice(0, 160))

  // ── Staff portals ────────────────────────────────────────────────────────
  const roles = [
    { role: 'admin', email: 'admin@mediroute.com', password: 'admin123', path: '/admin', label: 'ADMIN' },
    { role: 'hospital_staff', email: 'hospital@mediroute.com', password: 'hospital123', path: '/hospital', label: 'HOSPITAL' },
    { role: 'paramedic', email: 'paramedic@mediroute.com', password: 'paramedic123', path: '/paramedic', label: 'PARAMEDIC' },
  ]

  for (const r of roles) {
    console.log('\n=============================================')
    console.log(' ' + r.label + ' PORTAL')
    console.log('=============================================')

    const auth = await postJSON(API + '/auth/login', { email: r.email, password: r.password, role: r.role })

    if (!auth.token) {
      // /api/auth is limited to 20 attempts per 15 minutes. Repeated suite runs
      // exhaust it, which is the limiter working, not a regression. Say so
      // plainly rather than reporting a portal failure.
      if (/too many requests/i.test(auth.message || '')) {
        console.log('  SKIP  ' + r.label + ' — auth rate limit reached (20 logins / 15 min).')
        console.log('        Wait for the window to reset and re-run; this is not a failure.')
        continue
      }
      bad(r.label + ' login', JSON.stringify(auth).slice(0, 150))
      continue
    }

    // Seed the store on the app origin, then load the portal.
    await cdp.send('Page.navigate', { url: APP + '/' })
    await sleep(2500)
    await cdp.eval(seedAuth(auth.token, auth.user))
    await cdp.send('Page.navigate', { url: APP + r.path })
    await sleep(8000)

    t = await cdp.eval('document.body.innerText')
    const path = await cdp.eval('location.pathname')

    if (path === r.path) ok('portal loaded (not bounced to login)')
    else bad('portal route', 'ended at ' + path)

    if (t.length > 400) ok('portal rendered content (' + t.length + ' chars)')
    else bad('portal content', t.slice(0, 200))

    // The guidance and density controls should be mounted.
    const hasGuide = await cdp.eval(
      `Boolean([...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'How to use this screen'))`
    )
    hasGuide ? ok('help button present') : bad('help button present')

    const hasMode = await cdp.eval(
      `Boolean(document.querySelector('[aria-label="Display density"]'))`
    )
    hasMode ? ok('simple/full switch present') : bad('simple/full switch present')

    // None of the fabricated values that used to be hardcoded should appear.
    const ghosts = [
      ['19 Sep 2026', 'frozen date'],
      ['20:28:17', 'frozen clock'],
      ['05:40', 'frozen ETA'],
      ['76 km/h', 'frozen speed'],
      ['Average Turnaround', 'invented turnaround'],
      ['Adequate for 4 Major Polytraumas', 'invented blood copy'],
      ['/ 16 Active', 'invented ventilator total'],
    ]
    const found = ghosts.filter(([needle]) => t.includes(needle)).map(([, name]) => name)
    found.length === 0 ? ok('no fabricated values rendered') : bad('fabricated values still shown', found.join(', '))

    // Toggling density must not throw.
    await cdp.eval(`
    (() => {
      const g = document.querySelector('[aria-label="Display density"]');
      if (!g) return 'none';
      const b = [...g.querySelectorAll('button')].find(x => x.innerText.trim() === 'Simple');
      if (b) b.click();
      return 'ok';
    })()
    `)
    await sleep(1500)
    const afterToggle = await cdp.eval('document.body.innerText.length')
    afterToggle > 300 ? ok('simple mode renders') : bad('simple mode renders', afterToggle)

    // Open the walkthrough to prove it mounts.
    await cdp.eval(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'How to use this screen');
      if (b) b.click();
      return 'ok';
    })()
    `)
    await sleep(1200)
    t = await cdp.eval('document.body.innerText')
    if (t.includes('Got it') || t.includes('Next')) ok('portal walkthrough opens')
    else bad('portal walkthrough', t.slice(0, 150))
  }

  // ── Runtime errors across the whole run ──────────────────────────────────
  console.log('\n=============================================')
  console.log(' RUNTIME ERRORS')
  console.log('=============================================')
  const real = cdp.errors.filter(
    (e) =>
      e &&
      !/favicon|manifest|sw\.js|React DevTools|mapbox-gl.css|WebGL|Failed to load resource.*(404|403)|Socket|websocket|geolocation/i.test(
        e
      )
  )
  if (real.length === 0) ok('no uncaught JS errors in any portal')
  else {
    bad(real.length + ' JS error(s)', real.slice(0, 4).join(' || '))
  }

  console.log('\n=============================================')
  console.log(' RESULT: ' + pass + ' passed, ' + fail + ' failed')
  console.log('=============================================')
  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('harness error:', e.message)
  process.exit(2)
})
