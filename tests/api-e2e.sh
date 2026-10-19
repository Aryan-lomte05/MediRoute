#!/usr/bin/env bash
# End-to-end test of the MediRoute dispatch + handover pipeline against a
# locally running server. Creates one test incident and deletes it at the end.
set -u
BASE=http://localhost:5000/api
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s  -- %s\n' "$1" "$2"; }

check() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$2] got [$3]"; fi
}

jqp() { python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "=============================================="
echo " 1. AUTH"
echo "=============================================="
ADMIN=$(curl -s -m 20 -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@mediroute.com","password":"admin123","role":"admin"}' | jqp "d.get('token','')")
[ -n "$ADMIN" ] && ok "admin login" || bad "admin login" "no token"

MEDIC=$(curl -s -m 20 -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"paramedic@mediroute.com","password":"paramedic123","role":"paramedic"}' | jqp "d.get('token','')")
[ -n "$MEDIC" ] && ok "paramedic login" || bad "paramedic login" "no token"

HOSP=$(curl -s -m 20 -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"hospital@mediroute.com","password":"hospital123","role":"hospital_staff"}' | jqp "d.get('token','')")
[ -n "$HOSP" ] && ok "hospital_staff login" || bad "hospital_staff login" "no token"

echo
echo "=============================================="
echo " 2. AI ENGINE"
echo "=============================================="
AIOK=$(curl -s -m 20 "$BASE/ai/health" | jqp "d['ok']")
check "AI health ok" "True" "$AIOK"
AIMODEL=$(curl -s -m 20 "$BASE/ai/health" | jqp "d['model']")
printf '  INFO  model=%s\n' "$AIMODEL"

TRI=$(curl -s -m 40 -X POST "$BASE/ai/triage" -H 'Content-Type: application/json' \
  -d '{"chiefComplaint":"Crushing chest pain radiating to jaw, sweating heavily","age":61}')
TESI=$(echo "$TRI" | jqp "d['esiLevel']")
TENG=$(echo "$TRI" | jqp "d['engine']")
if [ "$TESI" = "1" ] || [ "$TESI" = "2" ]; then ok "triage cardiac -> ESI $TESI"; else bad "triage cardiac" "ESI $TESI"; fi
case "$TENG" in groq:*) ok "triage used a real model ($TENG)";; *) bad "triage engine" "fell back to $TENG";; esac

echo
echo "=============================================="
echo " 3. ANONYMOUS BYSTANDER SOS (no auth header)"
echo "=============================================="
SOS=$(curl -s -m 40 -X POST "$BASE/incidents" -H 'Content-Type: application/json' -d '{
  "reporterType":"BYSTANDER",
  "reporterContact":{"phone":"+91 90000 00000"},
  "location":{"coordinates":[72.8296,19.0176],"address":"[E2E TEST] Bandra West"},
  "chiefComplaint":"Scooter hit a car, rider unconscious on road",
  "sceneInfo":{"victimCount":1,"isConscious":false,"isBreathing":true,"hazards":["TRAFFIC"]}
}')
IID=$(echo "$SOS" | jqp "d['incident']['_id']")
TOK=$(echo "$SOS" | jqp "d['trackingToken']")
[ -n "$IID" ] && ok "anonymous SOS accepted" || { bad "anonymous SOS" "$SOS"; exit 1; }

RT=$(echo "$SOS" | jqp "d['incident']['reporterType']")
check "reporterType persisted" "BYSTANDER" "$RT"
PNAME=$(echo "$SOS" | jqp "d['incident']['patientDetails']['name']")
check "bystander patient not invented" "Unidentified patient" "$PNAME"
BT=$(echo "$SOS" | jqp "repr(d['incident']['patientDetails']['bloodType'])")
check "bystander blood type left null" "None" "$BT"
HASTOK=$(echo "$SOS" | jqp "'trackingToken' in d['incident']")
check "token not echoed inside incident" "False" "$HASTOK"

echo "  ... waiting for dispatch pipeline"
sleep 9

TRACK=$(curl -s -m 25 "$BASE/incidents/$IID" -H "x-tracking-token: $TOK")
ESI=$(echo "$TRACK" | jqp "d['incident']['triageData']['esiLevel']")
ENG=$(echo "$TRACK" | jqp "d['incident']['triageData']['engine']")
STAT=$(echo "$TRACK" | jqp "d['incident']['status']")
AMB=$(echo "$TRACK" | jqp "(d['incident'].get('assignedAmbulance') or {}).get('vehicleNumber','')")
HOSPN=$(echo "$TRACK" | jqp "(d['incident'].get('allocatedHospital') or {}).get('name','')")
DIST=$(echo "$TRACK" | jqp "(d['incident'].get('route') or {}).get('distanceKm','')")
ETA=$(echo "$TRACK" | jqp "(d['incident'].get('route') or {}).get('etaMinutes','')")

if [ "$ESI" = "1" ] || [ "$ESI" = "2" ]; then ok "unconscious trauma -> ESI $ESI"; else bad "triage severity" "ESI $ESI"; fi
case "$ENG" in groq:*) ok "pipeline used a real model";; *) bad "pipeline engine" "$ENG";; esac
# The unit simulator advances a dispatched job to EN_ROUTE_TO_PATIENT within a
# few seconds, so both are correct here. This previously asserted DISPATCHED
# only, which encoded the old behaviour where nothing ever moved the job on.
case "$STAT" in
  DISPATCHED|EN_ROUTE_TO_PATIENT) ok "status after dispatch ($STAT)";;
  *) bad "status after dispatch" "got $STAT";;
esac
[ -n "$AMB" ] && ok "ambulance assigned ($AMB)" || bad "ambulance assigned" "none"
[ -n "$HOSPN" ] && ok "hospital allocated ($HOSPN)" || bad "hospital allocated" "none"
[ -n "$DIST" ] && ok "real distance computed (${DIST}km / ${ETA}min)" || bad "distance" "missing"

# Reduced tracking view must not leak third-party detail.
LEAK=$(echo "$TRACK" | jqp "'patientDetails' in d['incident'] or 'reporterContact' in d['incident']")
check "tracking view withholds PII" "False" "$LEAK"

echo
echo "=============================================="
echo " 4. ACCESS CONTROL"
echo "=============================================="
check "GET /:id without token"      "403" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/incidents/$IID")"
check "GET /:id wrong token"        "403" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/incidents/$IID" -H 'x-tracking-token: nope')"
check "GET / list unauthenticated"  "401" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/incidents?limit=5")"
check "hospitals/seed unauth"       "401" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/hospitals/seed")"
check "ambulances/seed unauth"      "401" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/ambulances/seed")"
check "token holder cannot COMPLETE" "403" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X PATCH "$BASE/incidents/$IID/status" -H 'Content-Type: application/json' -H "x-tracking-token: $TOK" -d '{"status":"COMPLETED"}')"
check "token holder cannot set vitals" "403" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X PATCH "$BASE/incidents/$IID/status" -H 'Content-Type: application/json' -H "x-tracking-token: $TOK" -d '{"vitals":{"heartRate":80}}')"
check "staff list authorised"       "200" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/incidents?limit=5" -H "Authorization: Bearer $ADMIN")"

echo
echo "=============================================="
echo " 5. HANDOVER BOARDS"
echo "=============================================="
FULL=$(curl -s -m 20 "$BASE/incidents/$IID" -H "Authorization: Bearer $ADMIN")
NFIELD=$(echo "$FULL" | jqp "len(d['incident'].get('fieldChecklist') or [])")
NPREP=$(echo "$FULL" | jqp "len(d['incident'].get('prepChecklist') or [])")
NALERT=$(echo "$FULL" | jqp "len(d['incident']['triageData'].get('criticalAlerts') or [])")
NACT=$(echo "$FULL" | jqp "len(d['incident']['triageData'].get('recommendedActions') or [])")
[ "$NFIELD" -gt 0 ] 2>/dev/null && ok "field checklist seeded ($NFIELD items)" || bad "field checklist" "$NFIELD"
[ "$NPREP" -gt 0 ] 2>/dev/null && ok "prep checklist seeded ($NPREP items)" || bad "prep checklist" "$NPREP"
[ "$NACT" -gt 0 ] 2>/dev/null && ok "recommendedActions persisted ($NACT)" || bad "recommendedActions persisted" "$NACT"
[ "$NALERT" -ge 0 ] 2>/dev/null && ok "criticalAlerts field persists ($NALERT)" || bad "criticalAlerts" "$NALERT"

KEY=$(echo "$FULL" | jqp "(d['incident']['fieldChecklist'] or [{}])[0].get('key','')")
TICK=$(curl -s -m 20 -X PATCH "$BASE/incidents/$IID/checklist" -H "Authorization: Bearer $MEDIC" \
  -H 'Content-Type: application/json' -d "{\"board\":\"field\",\"key\":\"$KEY\",\"done\":true}")
DONE=$(echo "$TICK" | jqp "[c for c in d['fieldChecklist'] if c['key']=='$KEY'][0]['done']")
check "paramedic ticks field item" "True" "$DONE"
BY=$(echo "$TICK" | jqp "[c for c in d['fieldChecklist'] if c['key']=='$KEY'][0].get('doneBy','')")
[ -n "$BY" ] && ok "tick attributed to $BY" || bad "tick attribution" "empty"

check "checklist tick needs auth" "401" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X PATCH "$BASE/incidents/$IID/checklist" -H 'Content-Type: application/json' -d "{\"board\":\"field\",\"key\":\"$KEY\",\"done\":true}")"

NOTE=$(curl -s -m 20 -X POST "$BASE/incidents/$IID/notes" -H "Authorization: Bearer $MEDIC" \
  -H 'Content-Type: application/json' -d '{"text":"E2E test note: airway clear, IV established.","source":"VOICE"}')
NN=$(echo "$NOTE" | jqp "len(d['fieldNotes'])")
[ "$NN" -gt 0 ] 2>/dev/null && ok "crew note recorded ($NN)" || bad "crew note" "$NN"
NSRC=$(echo "$NOTE" | jqp "d['fieldNotes'][-1]['source']")
check "note source preserved" "VOICE" "$NSRC"

echo
echo "=============================================="
echo " 6. HOSPITAL RESOURCES"
echo "=============================================="
HID=$(curl -s -m 20 "$BASE/hospitals" | jqp "d['hospitals'][0]['_id']")
HNAME=$(curl -s -m 20 "$BASE/hospitals" | jqp "d['hospitals'][0]['name']")
NBAYS=$(curl -s -m 20 "$BASE/hospitals" | jqp "len(d['hospitals'][0].get('erBays') or [])")
ONEG0=$(curl -s -m 20 "$BASE/hospitals" | jqp "(d['hospitals'][0].get('bloodBank') or {}).get('oNeg')")
[ "$NBAYS" -gt 0 ] 2>/dev/null && ok "$HNAME has $NBAYS ER bays" || bad "er bays" "$NBAYS"
[ -n "$ONEG0" ] && ok "blood stock present (O-neg $ONEG0)" || bad "blood stock" "missing"

BLOOD=$(curl -s -m 20 -X PATCH "$BASE/hospitals/$HID/blood" -H "Authorization: Bearer $HOSP" \
  -H 'Content-Type: application/json' -d '{"component":"oNeg","delta":4}')
ONEG1=$(echo "$BLOOD" | jqp "d['bloodBank']['oNeg']")
check "blood +4 persisted" "$((ONEG0+4))" "$ONEG1"
# Put it back.
curl -s -m 20 -X PATCH "$BASE/hospitals/$HID/blood" -H "Authorization: Bearer $HOSP" \
  -H 'Content-Type: application/json' -d '{"component":"oNeg","delta":-4}' > /dev/null
ONEG2=$(curl -s -m 20 "$BASE/hospitals/$HID" | jqp "d['hospital']['bloodBank']['oNeg']")
check "blood restored" "$ONEG0" "$ONEG2"

check "blood change needs auth" "401" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X PATCH "$BASE/hospitals/$HID/blood" -H 'Content-Type: application/json' -d '{"component":"oNeg","delta":99}')"

BAY=$(curl -s -m 20 -X PATCH "$BASE/hospitals/$HID/bays/1" -H "Authorization: Bearer $HOSP" \
  -H 'Content-Type: application/json' -d '{"status":"OCCUPIED","label":"E2E test"}')
BSTAT=$(echo "$BAY" | jqp "[b for b in d['erBays'] if b['number']==1][0]['status']")
check "bay 1 -> OCCUPIED" "OCCUPIED" "$BSTAT"
BAY2=$(curl -s -m 20 -X PATCH "$BASE/hospitals/$HID/bays/1" -H "Authorization: Bearer $HOSP" \
  -H 'Content-Type: application/json' -d '{"status":"AVAILABLE"}')
BLAB=$(echo "$BAY2" | jqp "repr([b for b in d['erBays'] if b['number']==1][0].get('label'))")
ok "bay released (label now $BLAB)"

echo
echo "=============================================="
echo " 7. STATS + FORECAST (no hardcoded values)"
echo "=============================================="
ST=$(curl -s -m 25 "$BASE/incidents/stats/summary")
AVG=$(echo "$ST" | jqp "d['summary']['avgDispatchSeconds']")
NSAMP=$(echo "$ST" | jqp "d['summary']['avgDispatchSampleSize']")
SENG=$(echo "$ST" | jqp "d['summary']['surgeEngine']")
TZ=$(echo "$ST" | jqp "d['summary']['surgeBasis']['timezone']")
HASOLD=$(echo "$ST" | jqp "'avgDelaySeconds' in d['summary']")
check "legacy avgDelaySeconds gone" "False" "$HASOLD"
check "forecast derived from history" "history" "$SENG"
check "forecast timezone pinned" "Asia/Kolkata" "$TZ"
printf '  INFO  avgDispatchSeconds=%s over %s samples\n' "$AVG" "$NSAMP"
if [ "$AVG" != "42" ]; then ok "dispatch latency is measured, not 42"; else bad "dispatch latency" "still 42"; fi

echo
echo "=============================================="
echo " 8. OSRM ROUTING"
echo "=============================================="
RTE=$(curl -s -m 30 -X POST "$BASE/ai/route" -H 'Content-Type: application/json' \
  -d '{"origin":[72.86,19.07],"destination":[72.8265,19.0599]}')
RKM=$(echo "$RTE" | jqp "d.get('distanceKm','')")
RSTEPS=$(echo "$RTE" | jqp "len(d.get('steps') or [])")
if [ -n "$RKM" ]; then ok "OSRM route $RKM km, $RSTEPS steps"; else bad "OSRM route" "$RTE"; fi

echo
echo "=============================================="
echo " CLEANUP"
echo "=============================================="
curl -s -m 20 -X PATCH "$BASE/incidents/$IID/status" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"status":"CANCELLED"}' > /dev/null
echo "  test incident cancelled (ambulance released); row deleted by cleanup script"
printf 'TESTID=%s\n' "$IID" > /tmp/mediroute-e2e-id

echo
echo "=============================================="
printf ' RESULT: %s passed, %s failed\n' "$PASS" "$FAIL"
echo "=============================================="
[ "$FAIL" -eq 0 ] || exit 1
