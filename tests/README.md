# MediRoute tests

Everything here runs against the real stack - live database, live Groq models,
real browser. Nothing is mocked, so a pass means the feature genuinely works.

| Suite | What it covers | Runner |
|:---|:---|:---|
| `e2e/*.spec.js` | Every screen, tab and control, end to end | Playwright |
| `api-e2e.sh` | API, dispatch pipeline, access control (47 checks) | bash + curl |
| `browser-sos.cjs` | Public reporting flow (22 checks) | raw CDP |
| `browser-portals.cjs` | Landing and the three staff portals (30 checks) | raw CDP |

The Playwright suite supersedes the two `browser-*.cjs` scripts, which are kept
because they need no dependencies and are useful when Playwright's browsers are
not installed.

## Running

```bash
# One-time
npx playwright install chromium

# The API must be running
cd server && npm run dev

# Everything (the client is built and served automatically)
npm test

# Narrower
npx playwright test sos                 # one spec
npx playwright test --project=mobile    # phone profile only
npx playwright test --headed            # watch it
npm run test:report                     # open the last HTML report

# The curl suite
npm run test:api
```

## What the Playwright specs cover

| Spec | Covers |
|:---|:---|
| `sos.spec.js` | Both reporting branches, every question, validation, geolocation grant and denial, submission, dispatch, live tracking, resume after reload, cancellation, mobile ergonomics |
| `landing.spec.js` | Hero, routing to `/sos`, all nine walkthrough chapters, transport controls, legal modals, control labelling |
| `hospital.spec.js` | All four tabs, bay operation, blood ordering persistence, ventilator totals, simple/full, walkthrough |
| `admin.spec.js` | All five views, live AI status, clock, forecast sanity, simple/full, walkthrough |
| `paramedic.spec.js` | All four tabs, telemetry honesty, per-patient checklist, dictation labelling, simple/full |
| `patient.spec.js` | All four tabs, the route to `/sos`, simple/full, walkthrough |
| `pwa.spec.js` | Manifest validity, raster icons, apple-touch-icon, shortcuts, service worker registration, offline rendering |
| `ux.spec.js` | Cross-cutting rules: no JS errors, one `h1`, no fabricated values, keyboard access, focus visibility, responsive layout |

## Things that will bite you

- **A free ambulance is required.** An open incident holds its unit until it is
  closed, and there are only four vehicles. Global setup and teardown release
  them, and the teardown warns loudly when the fleet is empty. If dispatch
  assertions fail with no vehicle shown, run:
  ```bash
  node server/scripts/close-stale-incidents.cjs --apply
  ```

- **Test reports are tagged by phone number.** Reports filed through the UI
  carry a real geocoded address and are otherwise indistinguishable from
  genuine ones, so the suites write `+91 00000 00000` into the optional phone
  field and cleanup matches on that. If you add a spec that files a report, use
  `fillSosUpToConfirm` from `helpers.js` so it is tagged too.

- **Auth is rate limited.** `/api/auth` allows 20 attempts per 15 minutes.
  `helpers.js` caches one token per role for the whole run; do not log in
  inside a test. Restarting the API clears the limiter, which is in memory.

- **`innerText` reflects CSS.** Several headings carry an `uppercase`
  transform, so assertions against them are deliberately case-insensitive.

- **The API must not be in production mode locally.** Outside
  `NODE_ENV=production` any loopback origin is accepted, which is what lets the
  preview server on 4173 reach it. A production build of the server will refuse
  those requests by design.

- **Tests write to the real database.** Each dispatch spec creates one real
  incident, because the pipeline cannot be exercised without one. They are
  cleaned up on teardown.

## What these suites deliberately assert

Beyond "it works", several checks exist to stop specific regressions that were
present in this codebase:

- Triage reports an `engine` naming what produced it, so a keyword fallback is
  never presented as an AI assessment.
- Citizen screens express urgency in words and never leak the raw `ESI n` code
  or a status enum like `EN_ROUTE_TO_PATIENT`.
- No portal renders any of the previously hardcoded values: frozen clocks, a
  fixed ETA and speed, invented ventilator totals, fabricated vital signs, or a
  severity badge pinned to ESI 1.
- Unauthenticated writes are refused on every mutating endpoint, and the
  destructive seed routes require an admin session.
- The hero SOS control routes to `/sos`, not `/login`.
- The PWA manifest starts on the emergency page and declares icons that exist.
