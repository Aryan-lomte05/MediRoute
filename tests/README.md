# MediRoute tests

Three suites that exercise the real stack — the live database, the live Groq
models and a real browser. There is no mocking: a pass here means the feature
genuinely works end to end.

| Suite | What it covers | Checks |
|:---|:---|:---:|
| `api-e2e.sh` | API, dispatch pipeline, access control | 47 |
| `browser-sos.cjs` | The public reporting flow in a real browser | 22 |
| `browser-portals.cjs` | Landing, walkthrough, three staff portals | 30 |

## Prerequisites

- The API running on `http://localhost:5000` (`cd server && npm run dev`).
- For the browser suites, the built client being served, and a Chromium binary.
  `npx playwright install chromium` provides one if you have no Chrome.

## Running

```bash
# 1. API and pipeline
bash tests/api-e2e.sh

# 2. Build and serve the client
cd client && npm run build && npx vite preview --port 4173 --strictPort &

# 3. Start a browser with the DevTools protocol exposed
#    (adjust the path to any Chrome or Chromium build)
chrome --headless --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mediroute-test-profile about:blank &

# 4. Browser suites
node tests/browser-sos.cjs      http://localhost:4173
node tests/browser-portals.cjs  http://localhost:4173 http://localhost:5000/api
```

Each script exits non-zero if any check fails, so they drop into CI as-is.

## Notes on reading the results

- **Test data.** `api-e2e.sh` and `browser-sos.cjs` each create one real
  incident, because the dispatch pipeline cannot be exercised without one. Both
  cancel it at the end; rows are tagged `[E2E TEST]` in the address field so
  anything left behind is easy to find and delete.

- **A free ambulance is required.** The dispatch assertions need at least one
  unit with status `AVAILABLE`. If the fleet is fully committed, those checks
  fail for a legitimate operational reason rather than a regression. Release
  stale assignments first:

  ```js
  // units pointing at an incident that no longer exists or is closed
  db.ambulances.updateMany(
    { currentIncident: { $ne: null } },
    { $set: { status: 'AVAILABLE', currentIncident: null } }
  )
  ```

- **`innerText` reflects CSS.** Several headings carry a `uppercase`
  transform, so assertions against them are case-insensitive on purpose. A
  case-sensitive check against those strings will fail even though the page is
  correct.

- **The browser suites talk CDP directly** over `ws`, instead of adding
  Playwright or Puppeteer as a dependency. The trade-off is that they attach to
  the *first* page target, so a browser already holding port 9222 with another
  tab open will produce confusing failures. Start it with a fresh
  `--user-data-dir` for each run.

- **Auth rate limiting.** `/api/auth` allows 20 attempts per 15 minutes, and
  `browser-portals.cjs` signs in three times per run. Running the suites
  repeatedly will exhaust that window; the portal suite then prints `SKIP` with
  an explanation rather than reporting a false failure. Wait for the window to
  reset, or raise the limit locally while iterating.

- **CORS.** Outside `NODE_ENV=production` the API accepts any loopback origin,
  which is what lets `vite preview` on 4173 reach it. In production only the
  configured origins and Vercel preview subdomains are allowed, so a test run
  against a production build of the server will fail on CORS by design.

## What these suites deliberately assert

Beyond "it works", several checks exist to stop specific regressions that were
present in this codebase:

- Triage must report an `engine` naming the model that produced it, and the
  suites fail if a result silently falls back to the keyword rule engine while
  the AI is reachable.
- The citizen-facing screens must express urgency in words and must **not**
  leak the raw `ESI n` clinical code.
- The portals must not render any of the previously hardcoded values — frozen
  clocks, a fixed ETA and speed, invented ventilator totals, or a severity
  badge pinned to ESI 1.
- Unauthenticated writes must be refused on every mutating endpoint, and the
  destructive seed routes must require an admin session.
