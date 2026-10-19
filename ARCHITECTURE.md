# MediRoute: where everything lives

A feature-to-code index. Every row points at the file and the function that
actually implements the thing, so you can open the code for any claim made
about this project.

Line numbers drift as the code changes. The symbol names do not, so search for
the function name if a line number looks off.

---

## 1. The one-minute version

```
Citizen taps SOS  ->  POST /api/incidents        (public, no account)
                         |
                         v
                  runDispatchPipeline()          routes/incidents.js:240
                         |
         +---------------+---------------+
         |               |               |
         v               v               v
   triageIncident()  allocateHospital()  nearest free unit
   aiService.js:322  incidents.js:109    ($nearSphere query)
         |               |               |
         +---------------+---------------+
                         |
                         v
            Socket.IO broadcast to the rooms that care
                         |
                         v
      unitSimulator.js drives the vehicle along the road
```

---

## 2. Public emergency reporting (`/sos`)

The highest-stakes surface: anonymous, mobile, used under stress.

| What | Where |
|:---|:---|
| The whole page | `client/src/pages/SosPortal.jsx` |
| Branch chooser (self vs bystander) | `SosPortal.jsx:697` `ChooseBranch` |
| Self-report questions | `SosPortal.jsx:48` `SELF_COMPLAINTS` |
| Bystander questions | `SosPortal.jsx:62` `BYSTANDER_SITUATIONS` |
| "Not sure" as a real answer | `SosPortal.jsx:75` `TRISTATE` |
| Question screen | `SosPortal.jsx:737` `DescribeStep` |
| Location screen | `SosPortal.jsx:902` `ConfirmStep` |
| Tracking screen | `SosPortal.jsx:1040` `ActiveReport` |
| Plain-language status words | `SosPortal.jsx:101` `STATUS_WORDS` |
| Urgency in words, never "ESI n" | `SosPortal.jsx:118` `URGENCY_WORDS` |
| Voice recording | `SosPortal.jsx:258` `startRecording` |
| Reverse geocode (GPS to address) | `SosPortal.jsx:242` `reverseGeocode` |
| Forward geocode (typed address) | `SosPortal.jsx:319` `geocodeAddress` |
| Submit | `SosPortal.jsx:337` `submitReport` |
| Cancel own report | `SosPortal.jsx:462` `cancelReport` |
| Route registration (outside auth) | `client/src/App.jsx` `<Route path="/sos">` |

**Why there is no login here:** `/sos` is deliberately registered outside
`ProtectedRoute` in `App.jsx`. The 401 interceptor in `client/src/lib/api.js`
also refuses to redirect on public paths, so a failed request cannot throw a
reporter out to a login form mid-report.

**How an anonymous reporter tracks their own incident:** creation returns a
one-time `trackingToken`. It is stored on the device and sent as the
`x-tracking-token` header. The server checks it in
`server/src/routes/incidents.js:650` (`GET /:id`) and returns a reduced view
with no third-party medical detail.

---

## 3. AI

Everything AI lives in one file so model ids cannot drift apart again.

| What | Where |
|:---|:---|
| All model configuration | `server/src/services/aiService.js:47` `CHAT_MODELS` |
| Provider cascade | `aiService.js:113` `callLLM` |
| JSON extraction from model output | `aiService.js:77` `extractJSON` |
| Clinical triage | `aiService.js:322` `triageIncident` |
| Hospital ranking | `aiService.js:378` `rankHospitals` |
| Speech to text (Whisper) | `aiService.js:448` `transcribeAudio` |
| Surge forecast from history | `aiService.js:483` `forecastSurge` |
| Provider health | `aiService.js:587` `getAIHealth` |
| Deterministic fallback | `aiService.js:184` `clinicalRuleTriage` |
| Punctuation normalising | `aiService.js:288` `cleanText` |
| HTTP endpoints | `server/src/routes/ai.js` |
| Status badge in the UI | `client/src/components/AiStatusBadge.jsx` |

**The honesty contract.** Every AI result carries an `engine` field naming what
produced it: a model id such as `groq:openai/gpt-oss-120b`, or `rules` for the
deterministic fallback. The UI must never present a `rules` result as an AI
assessment. See `TriageEngineNote` in `AiStatusBadge.jsx`, and the amber warning
in `SosPortal.jsx` `ActiveReport`.

**Why the fallback exists.** An emergency system must always produce a severity.
If every model tier is unreachable, `clinicalRuleTriage` assigns one from
keywords and vitals and reports 0.55 confidence, not a fabricated high number.

---

## 4. Dispatch

| What | Where |
|:---|:---|
| The pipeline | `server/src/routes/incidents.js:240` `runDispatchPipeline` |
| Hospital allocation (single impl) | `incidents.js:109` `allocateHospital` |
| Candidate shaping | `incidents.js:79` `toCandidate` |
| Distance | `incidents.js:61` `haversineKm` |
| ETA from distance | `incidents.js:73` `etaMinutes` |
| Crew checklist, per patient | `incidents.js:181` `buildFieldChecklist` |
| ER prep checklist, per patient | `incidents.js:198` `buildPrepChecklist` |
| Nearest free unit | inside `runDispatchPipeline`, `$nearSphere` |

**Order of operations:** triage, then hospital, then vehicle. Hospital choice
depends on the specialties triage asks for, and the vehicle is chosen by
distance to the patient, so the sequence matters.

**Diversion is a hard rule.** `allocateHospital` refuses to rank a diverting
hospital first unless every candidate is diverting, regardless of what the
model returns.

**Nothing blocks the citizen.** `POST /api/incidents` returns as soon as the row
is written; the pipeline runs detached and announces each stage over Socket.IO.

---

## 5. Making the ambulance move

| What | Where |
|:---|:---|
| The simulator | `server/src/services/unitSimulator.js` |
| One tick of one job | `unitSimulator.js:161` `stepIncident` |
| Move along a polyline | `unitSimulator.js:118` `advanceAlong` |
| Real road geometry | `unitSimulator.js:99` `fetchRoad` |
| Loop | `unitSimulator.js:306` `tick` |
| Started from | `server/src/index.js` `startUnitSimulator(io)` |
| Real crew telemetry instead | `client/src/pages/ParamedicPortal.jsx` `watchPosition` |

**Why it exists.** Position is normally written by the crew device through
`PATCH /api/ambulances/:id/location`. With nobody signed in, an assigned unit
never moved: the tracking map showed a parked vehicle, the ETA never counted
down, and the job stayed `DISPATCHED`.

**A real device always wins.** A unit whose `lastPing` is newer than
`RECENT_PING_MS` is left alone. Simulated units are flagged `isSimulated` and
every broadcast carries `simulated: true`.

Turn it off with `ENABLE_UNIT_SIMULATION=false`.

---

## 6. Access control

| Surface | Who |
|:---|:---|
| `POST /api/incidents` | anyone, no account |
| `GET /api/incidents/:id` | staff, the owner, or a valid tracking token |
| `PATCH /api/incidents/:id/status` | staff; a token holder may only cancel |
| `GET /api/incidents` (list) | staff only, it returns city-wide PII |
| `POST /api/incidents/:id/allocate` | staff only |
| `PATCH /api/hospitals/:id/*` | `hospital_staff` or `admin` |
| `PATCH /api/ambulances/:id/*` | `paramedic` or `admin` |
| `POST /api/*/seed` | `admin` only, destructive |
| `GET /api/hospitals` | public, the landing map needs it |

Middleware: `server/src/middleware/auth.js` (`auth`, `authorize`,
`optionalAuth`). Tracking-token checks live in `routes/incidents.js`, because
they grant access to one record rather than establishing a session.

CORS and security headers: `server/src/index.js`. Socket origin policy:
`server/src/sockets/index.js`.

---

## 7. Real-time events

Server: `server/src/sockets/index.js`. Client: `client/src/lib/socket.js`.

| Room | Who is in it |
|:---|:---|
| `admin`, `paramedic`, `hospital_staff`, `patient` | everyone with that role |
| `user_<id>` | one person |
| `ambulance_<id>` | the crew on that vehicle |
| `hospital_<id>` | staff at that hospital |
| `incident_<id>` | everyone following one case |

| Event | Emitted by |
|:---|:---|
| `new_incident` | `routes/incidents.js` on create |
| `triage_complete` | `runDispatchPipeline` |
| `hospital_allocated`, `incoming_patient` | `runDispatchPipeline` |
| `dispatch_alert`, `ambulance_assigned` | `runDispatchPipeline` |
| `dispatch_blocked` | `runDispatchPipeline` when no unit is free |
| `ambulance_location` | `unitSimulator.js`, or `routes/ambulances.js` |
| `incident_status` | `routes/incidents.js`, `unitSimulator.js` |
| `checklist_updated`, `field_note_added` | `routes/incidents.js` |
| `blood_bank_update`, `er_bays_update` | `routes/hospitals.js` |
| `triage_escalated` | `routes/incidents.js` when vitals worsen severity |

An anonymous reporter holds no JWT and so cannot open a socket. Their tracking
screen polls instead; see the effect in `SosPortal.jsx`.

---

## 8. Guidance and density

| What | Where |
|:---|:---|
| Landing walkthrough | `client/src/components/ProductTour.jsx` |
| Its script | `ProductTour.jsx:360` `CHAPTERS` |
| Per-chapter visuals | `ProductTour.jsx:89` onwards, `Scene*` |
| Per-portal walkthrough | `client/src/components/PortalGuide.jsx:170` `GuideOverlay` |
| Help button | `PortalGuide.jsx:258` `GuideButton` |
| Simple/Full switch | `PortalGuide.jsx:127` `ModeToggle` |
| Jargon explainer | `PortalGuide.jsx:66` `Jargon` |
| Glossary | `PortalGuide.jsx:38` `GLOSSARY` |
| Stored preference | `client/src/store/uiStore.js` |

Each portal reads `simple` from `uiStore`, hides its specialist tabs, and snaps
back to an allowed view if the current one is hidden. Search `const simple =`
in any portal to find its implementation.

---

## 9. Data model

| Collection | File | Notes |
|:---|:---|:---|
| `incidents` | `server/src/models/Incident.js` | the case record |
| `ambulances` | `models/Ambulance.js` | fleet and live position |
| `hospitals` | `models/Hospital.js` | capacity, bays, blood |
| `users` | `models/User.js` | staff and citizen accounts |
| `counters` | `models/Counter.js` | atomic reference numbers |

Fields worth knowing on `Incident`:

- `reporterType` `SELF` or `BYSTANDER`; changes what is asked and how triage weighs it
- `sceneInfo` what an untrained caller could observe
- `location.source` `GPS`, `GEOCODED` or `UNKNOWN`, so the crew knows the precision
- `trackingToken` anonymous ownership, `select: false`
- `triageData.engine` what produced the assessment
- `fieldChecklist` / `prepChecklist` shared across the handover
- `fieldNotes` crew observations, including dictated ones

---

## 10. Scripts and tests

| Command | Does |
|:---|:---|
| `node server/scripts/close-stale-incidents.cjs` | dry-run: find abandoned jobs holding units |
| `... --apply` | close them and release the ambulances |
| `node server/scripts/migrate-hospital-resources.cjs` | backfill bays, blood, ICU capability |
| `node server/scripts/init-incident-counter.cjs` | seed the counter past existing numbers |
| `npm test` | the Playwright UI suite |
| `npm run test:api` | the API and pipeline suite |

Test coverage map is in `tests/README.md`.

---

## 11. Things that will bite you

1. **An open incident holds its ambulance.** Only `AVAILABLE` units are
   dispatchable, so abandoned jobs shrink the fleet until nothing can be sent.
   Run `close-stale-incidents.cjs` before any demo.

2. **`Hospital.capabilities` must cover `SPECIALTIES` in `aiService.js`.** A
   token triage emits but no hospital declares will silently score zero.

3. **The hosting free tier sleeps.** A cold start can exceed a normal request
   timeout. `/sos` wakes the API on mount and allows a long submit timeout.

4. **Model ids are configuration, not constants.** A provider can decommission
   one at any time. `GET /api/ai/health` reports whether the configured model is
   actually available; the badge in the UI surfaces it.

5. **Never generate reference numbers from a count.** It collides under
   concurrency and after deletion. Use `Counter.next()`.
