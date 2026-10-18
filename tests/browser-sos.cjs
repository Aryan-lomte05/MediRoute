/**
 * Browser-level test of the public SOS flow, driven over the Chrome DevTools
 * Protocol. Exercises the real built client against the real local API: taps
 * through the bystander branch, submits, and verifies the dispatch result
 * appears on screen.
 *
 * Run:  node browser-test.cjs <appUrl>
 */

const WebSocket = require(require.resolve('ws', {
  paths: [String.raw`E:\Personal or College Projects\Mediroute\client\node_modules`],
}))
const http = require('http')

const APP = process.argv[2] || 'http://localhost:4173'
const DEBUG_PORT = 9222

let pass = 0
let fail = 0
const ok = (m) => {
  pass++
  console.log('  PASS  ' + m)
}
const bad = (m, d) => {
  fail++
  console.log('  FAIL  ' + m + (d ? '  -- ' + d : ''))
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: DEBUG_PORT, path }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.consoleErrors = []

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
      // Collect real page errors so a silent crash cannot pass as success.
      if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(
          msg.params?.exceptionDetails?.exception?.description ||
            msg.params?.exceptionDetails?.text ||
            'unknown exception'
        )
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description).join(' '))
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
          reject(new Error('CDP timeout: ' + method))
        }
      }, 30000)
    })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Click the first element whose trimmed text matches, searching buttons/links. */
const CLICK_BY_TEXT = (text, exact) => `
(() => {
  const want = ${JSON.stringify(text)};
  const nodes = [...document.querySelectorAll('button, a, [role=button]')];
  const el = nodes.find(n => {
    const t = (n.innerText || '').trim();
    return ${exact ? 't === want' : 't.includes(want)'};
  });
  if (!el) return 'NOT_FOUND';
  el.click();
  return 'CLICKED';
})()
`

const BODY_TEXT = `document.body.innerText`

/** Guards against ASI hazards from lines that would start with a regex. */
let PAGE = ''
const has = (re) => re.test(PAGE)

async function main() {
  console.log('Connecting to browser...')
  const targets = await getJSON('/json/list')
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })

  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  // Pretend to be a phone in Mumbai, with location granted.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  })
  await cdp.send('Browser.grantPermissions', {
    origin: APP,
    permissions: ['geolocation'],
  })
  await cdp.send('Emulation.setGeolocationOverride', {
    latitude: 19.0176,
    longitude: 72.8296,
    accuracy: 20,
  })

  console.log('\n=============================================')
  console.log(' BROWSER: public SOS flow (bystander branch)')
  console.log('=============================================')

  await cdp.send('Page.navigate', { url: APP + '/sos' })
  await sleep(3500)

  let text = await cdp.eval(BODY_TEXT)
  text.includes('Get emergency help') ? ok('SOS page rendered') : bad('SOS page rendered', text.slice(0, 120))
  text.includes('No account needed') ? ok('states no account needed') : bad('no-account copy')
  text.includes('108') ? ok('emergency number visible') : bad('emergency number visible')

  // Branch: someone else.
  let r = await cdp.eval(CLICK_BY_TEXT('Someone else needs help'))
  r === 'CLICKED' ? ok('tapped bystander branch') : bad('tapped bystander branch', r)
  await sleep(1200)

  text = await cdp.eval(BODY_TEXT)
  text.includes('What has happened') ? ok('bystander question screen') : bad('bystander question screen', text.slice(0, 150))
  text.includes('Is the person awake') ? ok('asks only observable facts') : bad('observable questions')

  // Pick a situation.
  r = await cdp.eval(CLICK_BY_TEXT('Road accident'))
  r === 'CLICKED' ? ok('selected a situation') : bad('selected a situation', r)
  await sleep(400)

  // Answer the two tri-state questions: awake = No, breathing = Yes.
  const answered = await cdp.eval(`
  (() => {
    const groups = [...document.querySelectorAll('fieldset')];
    let done = [];
    for (const g of groups) {
      const legend = (g.querySelector('legend')?.innerText || '').trim();
      const btns = [...g.querySelectorAll('button')];
      if (legend.includes('awake')) {
        const b = btns.find(x => x.innerText.trim() === 'No'); if (b) { b.click(); done.push('awake=No'); }
      } else if (legend.includes('breathing')) {
        const b = btns.find(x => x.innerText.trim() === 'Yes'); if (b) { b.click(); done.push('breathing=Yes'); }
      }
    }
    return done.join(',');
  })()
  `)
  answered.includes('awake=No') && answered.includes('breathing=Yes')
    ? ok('answered scene questions (' + answered + ')')
    : bad('answered scene questions', answered)
  await sleep(400)

  // Continue to the location screen.
  r = await cdp.eval(CLICK_BY_TEXT('Continue', true))
  r === 'CLICKED' ? ok('tapped Continue') : bad('tapped Continue', r)
  await sleep(2500)

  text = await cdp.eval(BODY_TEXT)
  text.includes('Where should we send help') ? ok('location screen') : bad('location screen', text.slice(0, 150))
  // innerText returns the CSS-transformed text, and this label is uppercased.
  if (/location found/i.test(text)) ok('geolocation resolved')
  else if (text.includes('Type where the emergency is')) ok('geolocation denial handled with manual entry')
  else bad('location state', text.slice(0, 200))

  // Send.
  r = await cdp.eval(CLICK_BY_TEXT('Send for help now'))
  r === 'CLICKED' ? ok('tapped Send for help') : bad('tapped Send for help', r)

  // Wait out triage + dispatch.
  console.log('  ... waiting for triage and dispatch')
  let dispatched = false
  for (let i = 0; i < 14; i++) {
    await sleep(2500)
    text = await cdp.eval(BODY_TEXT)
    PAGE = text
    if (has(/MH-AMB-\d+/) && has(/Reference INC-/)) {
      dispatched = true
      break
    }
  }

  text = await cdp.eval(BODY_TEXT)
  PAGE = text
  if (has(/Reference INC-/)) ok('report created with a reference number')
  else bad('report reference', text.slice(0, 250))

  if (has(/Report received|Urgency assessed|Ambulance on the way/)) ok('plain-language status shown')
  else bad('status wording', text.slice(0, 250))

  if (dispatched) ok('dispatch reached the tracking screen')
  else bad('dispatch tracking', text.slice(0, 300))

  // Urgency should be words, never a bare ESI number, on the citizen screen.
  if (has(/Most urgent|Very urgent|Urgent|Less urgent|Non-urgent/)) ok('urgency expressed in words')
  else bad('urgency wording', 'none found')

  if (has(/ESI \d/)) bad('leaks clinical ESI code to citizen', 'found ESI n')
  else ok('no raw ESI code shown to citizen')

  if (has(/MH-AMB-\d+/)) ok('assigned vehicle shown (' + text.match(/MH-AMB-\d+/)[0] + ')')
  else bad('assigned vehicle shown')

  if (has(/minutes away/)) ok('ETA shown')
  else console.log('  INFO  no ETA yet (route may still be computing)')

  // Resume behaviour: reload and confirm the report comes back.
  await cdp.send('Page.reload', { ignoreCache: false })
  await sleep(4500)
  text = await cdp.eval(BODY_TEXT)
  PAGE = text
  if (has(/Reference INC-/)) ok('report resumes after reload')
  else bad('resume after reload', text.slice(0, 200))

  // Cancel so the test leaves nothing active.
  r = await cdp.eval(CLICK_BY_TEXT('no longer needed'))
  await sleep(2500)
  text = await cdp.eval(BODY_TEXT)
  PAGE = text
  if (r === 'CLICKED' && has(/Get emergency help/)) ok('reporter can cancel their own report')
  else bad('cancel own report', r + ' / ' + text.slice(0, 120))

  // No uncaught errors anywhere in that journey.
  const real = cdp.consoleErrors.filter(
    (e) => e && !/favicon|manifest|sw\.js|Download the React DevTools|mapbox/i.test(e)
  )
  real.length === 0 ? ok('no uncaught JS errors during the flow') : bad('JS errors', real.slice(0, 3).join(' | '))

  console.log('\n=============================================')
  console.log(' RESULT: ' + pass + ' passed, ' + fail + ' failed')
  console.log('=============================================')

  ws.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('Test harness error:', e.message)
  process.exit(2)
})
