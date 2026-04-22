# Tampermoney-az-home-auto

1
AZ Stage Runner + AZ Payload Grabber V1.9
Opens pipeline tickets one-by-one. Validates 13 AZ fields, clicks Auto or Home link, then waits for "Bot Quoted" tag before advancing to the next card.
GM_setValueredundant @match
1.9
1,321
 
Pipeline A — AZ → LEX → GWPC
Pipeline B — AZ → GWPC direct ✦ new
Utilities
All 24 scripts
Execution order ↓GMuses GM storage APIflaglocalStorage handoff flag
AgencyZoom
Script
Ver
Lines
1
AZ Stage Runner + AZ Payload Grabber V1.9
Opens pipeline tickets one-by-one. Validates 13 AZ fields, clicks Auto or Home link, then waits for "Bot Quoted" tag before advancing to the next card.
GM_setValueredundant @match
1.9
1,321
opens Salesforce LEX tab
Salesforce LEX
Script
Ver
Lines
2
Sheet Reader V1.6
Fetches Google Sheet fresh on each trigger. Skips rows where col AA has a value. Saves the selected payload for the next step. Blocks itself while AZ is open.
GM_xmlhttpRequestno @noframes
1.6
730
3
LEX Quote New Account V3.9
Reads the Sheet Reader payload (flat or nested shape) and fills every field in the Quote New Account form. Hard-stops after Save is clicked.
no @noframes
3.9
1,485
3a
LEX Duplicates Continue V1.8
Intercepts the Duplicates Found modal if it appears. Selects the first match, waits for Continue to enable, clicks it.
no @noframes
1.8
756
4
LEX Continue New Quote V1.8
Detects the Personal Lines Quote modal, clicks the Home control (custom107), selects Residence Address, clicks Continue New Quote exactly once.
no @noframes
1.8
863
opens Guidewire PolicyCenter tab
Guidewire PolicyCenter
Script
Ver
Lines
5
01 GWPC Start Auto Quote V1.6
Waits for Current Activities, reloads once, clicks Start New Submission, selects Personal Auto row only.
1.6
647
6
Guidewire Policy Info V1.9
Fills Policy Info. Branches on Personal Auto presence. Handles Non-Binary/Flex gender error by switching to Male. DT2 Next retry if stuck.
1.9
494
7
Guidewire Disclosure Qualification V1.9
Clicks Yes on all disclosure questions. Handles 2 extra Personal Auto Yes radios. DT2 Next retry. Hard-stops if Submission (Quoted) appears.
1.9
488
8
Dwelling Water Rule V3.0
Dwelling step. Optional Create Valuation + Plumbing Replaced. Year Built water-device rule. Fixes Garage Type after first Quote failure.
no @noframes
3.0
778
9
04 GWPC Home Coverages + Risk Analysis V1.0.9
Edit All → applies coverage changes → Quote → Risk Analysis.
1.0.9
907
— Auto Data Prefill chain (flag handoff) —
10
1) AQB Drivers Only V1.6
Gate: Draft + Personal Auto + "Auto Data Prefill" header. Sets dropdowns, Gender, DOB (26–50), Age Lic (16–22).
→ aqb_step_drivers_done=1
1.6
382
11
2) AQB Vehicles Only V1.3
Waits for drivers_done=1. Removes incomplete vehicle rows. Sets Primary Driver to first non-<none>.
← drivers_done=1   → vehicles_done=1 + specialty_start=1
1.3
388
12
03 AQB Specialty Product V1.5
Waits for specialty_start=1. If Specialty empty → Quote directly. Otherwise removes rows → Quote (up to 3 retries).
← specialty_start=1   → specialty_done=1
1.5
307
13
Webhook Submission V1.4
Waits for Quote header. Reads home payload, POSTs to Zapier/Pabbly/custom. Clicks Auto after success. Blocks infinite auto-fail loops.
GM_xmlhttpRequest@connect * wildcardno @noframes
1.4
997
 
