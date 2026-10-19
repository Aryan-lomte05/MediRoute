# MediRoute demo script

What to run, what to say, and what should happen. Written to be followed
line by line, including the exact words to speak into the phone.

Run the preflight first, every time:

```powershell
.\scripts\preflight.ps1
```

It must say **Ready**. If it warns that only one ambulance is free, a second
report during the demo will be triaged but never dispatched, and nothing on
screen will explain why.

---

## Before you start

| Thing | Why |
|---|---|
| Open `https://mediroute-five.vercel.app/admin` on the big screen | The command centre is the view that shows everything landing |
| Sign in as `admin@mediroute.com` / `admin123` | |
| Leave it on **3D Tactical GIS** | New incidents appear in the left feed as they arrive |
| Have your phone ready | WhatsApp opted in to the sandbox, and the number saved |
| Wake the backend | Preflight does it. It sleeps again after ~15 minutes idle |

The backend sleeping is the single most likely thing to spoil a demo. A cold
start takes most of a minute and Twilio abandons a webhook after fifteen
seconds, so the first call after a break simply fails.

---

## 1. The citizen path, on a phone

Open `https://mediroute-five.vercel.app/sos`.

**Say while you do it:** "No login, no account. This is the whole point."

1. Tap **Someone else needs help**
2. Tap **Road accident**
3. Is the person awake? **No**
4. Are they breathing? **Yes**
5. Tap **Continue**, allow location
6. Tap **Send for help now**

**What should happen:** a reference number appears within a second or two, then
the status moves through plain-language steps, then a vehicle number and an
ETA. Urgency reads **Most urgent**, never "ESI 1".

**Worth pointing at:** the bystander branch never asks for a blood group. A
stranger cannot know it, so the patient record is left explicitly
unidentified rather than filled in with the reporter's own details.

### Then switch language

Tap the language control in the header, choose **हिन्दी**.

The whole page changes, including the questions and the options, not just the
heading. Reload to show the choice is remembered.

---

## 2. WhatsApp

Send to the sandbox number:

```
Accident near Bandra station, man unconscious and bleeding
```

**Expected reply:** a reference number and a tracking link.

**What to point out on the Admin screen:** the incident arrives tagged
`whatsapp`, with a real severity and an assigned unit. The location resolved to
Bandra in Mumbai.

> The geocoder originally read that sentence and matched "Banda" in Uttar
> Pradesh, about a thousand kilometres away, and an ambulance would have been
> dispatched there. The place phrase is now extracted and anything outside the
> service radius is rejected. Worth mentioning if anyone asks what could go
> wrong.

---

## 3. SMS

Send to **+1 984 367 5470**:

```
My father has chest pain, we are near Dadar station
```

Same expected result, tagged `sms`. Severity should come back more urgent than
the WhatsApp one, because chest pain in an older patient is treated as cardiac
until proven otherwise.

---

## 4. The AI call, in English

Call **+1 984 367 5470**.

It answers, then offers Hindi and Marathi, then listens.

**Say exactly:**

> "My father is having chest pain. We are near Dadar station."

**Expected:** it asks you one follow-up question, not a list. Usually for the
exact location or his condition.

**Then say:**

> "He is awake but sweating a lot. We are outside the east entrance."

**Expected:** it tells you help is on the way and connects you to an operator.

**What to point at:** the incident is already on the Admin screen before the
call has ended.

---

## 5. The AI call, in Hindi or Marathi

This is the one worth saving for last.

Call the same number. When it starts listening, **speak Hindi**:

> "मेरे पिताजी को सीने में दर्द हो रहा है, हम दादर स्टेशन के पास हैं"
>
> *(mere pitaji ko seene mein dard ho raha hai, hum Dadar station ke paas hain)*

**Expected:** it answers **in Hindi**. You did not tell it which language to
use; it worked that out from what you said.

Or in Marathi:

> "माझ्या वडिलांना छातीत दुखत आहे, आम्ही दादर स्टेशनजवळ आहोत"
>
> *(mazya vadilanna chhatit dukhat aahe, aamhi Dadar station javal aahot)*

**What to point at on Admin:** the complaint and the location are recorded in
**English** for the crew, while the caller was answered in their own language.
The record stays readable for whoever picks up the job.

---

## 6. The command centre

Back on the Admin screen.

1. Click the newest incident in the left feed
2. The map frames the **whole route**, not just a point
3. The red line is the actual road path from the routing engine
4. The ambulance marker moves along it, with the ETA counting down
5. Open the clinical assessment panel: that text came from the model

**Then show the AI badge** in the header. It reads **AI ONLINE** with the model
name, because it polls the provider rather than asserting it in static text.

> That badge exists because triage was dead in production for weeks. Both
> configured models had been decommissioned, every triage silently fell back to
> keyword matching, and it reported itself as AI with 0.94 confidence. Nothing
> in the interface distinguished the two. If you want a single line about what
> is different here, that is it.

**Switch to Simple** in the header. The specialist views disappear and the
screen explains itself in one sentence. Switch back to Full.

---

## 7. The walkthrough

On the landing page, click **Watch how it works**.

Four tracks, one per role. Play the citizen one, then open the paramedic one to
show they differ. Captions are real text, not burnt into a video, so they are
selectable and translate.

---

## Questions you should expect

**"Is the AI actually doing anything, or is it a wrapper?"**
Triage, hospital ranking and transcription are real model calls. Routing is
OSRM, the demand forecast is statistics over your own incident history, and the
fallback is a rule engine. All four are labelled as what they are. The forecast
tab is called Demand Forecast, not AI, for exactly this reason.

**"What happens if the AI is down?"**
A deterministic clinical protocol assigns a severity so a dispatch is never
blocked, reports 0.55 confidence rather than a fabricated high number, and the
UI labels it as the offline protocol. You can demonstrate this by setting a bad
model id.

**"What if two people report at the same moment?"**
Both are accepted. Reference numbers come from an atomic counter. The earlier
approach derived them from a document count, so simultaneous reports collided
and one was dropped with a 500.

**"How do you know the ambulance is where you say it is?"**
A crew device posts its position and the server defers to it. With no crew
signed in, the server drives the unit along the real road route and every
broadcast is flagged `simulated`, so a demo vehicle is never passed off as a
real crew.

**"What is not finished?"**
EmailJS is unconfigured. The staff portal interiors are not translated yet,
only their chrome and the citizen surfaces. There is no live patient monitor.
Say so plainly; all three are easy to defend as scope.

---

## If something goes wrong

| Symptom | Cause | Do this |
|---|---|---|
| Twilio error 11200 | Backend asleep | Hit `/health`, wait, retry |
| Report triaged but no ambulance | Fleet exhausted | `node server/scripts/close-stale-incidents.cjs --apply` |
| Badge reads AI DEGRADED | Model unavailable | Check `/api/ai/health`. Triage still works, labelled as the protocol |
| WhatsApp message rejected | Tester not opted in | Send the sandbox join code from that phone |
| Map shows no route | Unit not yet moving | Routes draw once a unit starts a leg, a few seconds after dispatch |

Never claim a message was delivered because the UI did not show an error. Every
send reports `delivered` explicitly, and with no credentials it returns
`success: false` with the body it would have sent.
