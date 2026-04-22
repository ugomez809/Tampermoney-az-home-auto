# Tampermoney-az-home-auto

Tampermonkey userscripts that automate an auto + home insurance quote pipeline
across three tabs:

1. **AgencyZoom (AZ)** — `app.agencyzoom.com` — opportunity pipeline, lead intake.
2. **Salesforce Lightning (APEX)** — `farmersagent.lightning.force.com` — account
   modals and APEX-side flow handlers.
3. **Guidewire PolicyCenter (GWPC)** — `policycenter[-2|-3].farmersinsurance.com` —
   submission, rating, quote data capture, webhook delivery.

Lead data is captured on the AZ side and handed to GWPC via shared
localStorage + GM storage. Quote results are scraped from GWPC and POSTed to a
webhook (Pabbly) for downstream processing.

## Pipeline flow

```
┌─────────────────────────┐
│ AZ Stage Runner V2.3    │  picks tickets, validates 13 fields
└──────────┬──────────────┘
           │ writes: tm_shared_az_job_v1,
           │         tm_az_current_job_v1,
           │         tm_pc_current_job_v1
           ▼
┌─────────────────────────┐
│ Shared Ticket Handoff   │  mirrors Ticket ID + Name + Address from AZ → GWPC
└──────────┬──────────────┘
           ▼
┌─────────────────────────────────────────────────────────────────┐
│ GWPC submission flow                                             │
│                                                                  │
│  01 Start Auto Quote  →  Policy Info  →  Disclosure             │
│    →  AQB Drivers  →  AQB Vehicles  →  AQB Specialty            │
│    →  Dwelling Water Rule  →  Home Coverages + Risk Analysis    │
│    →  Home Quote Grabber + Auto Quote Grabber                   │
└──────────┬───────────────────────────────────────────────────────┘
           │ payloads saved to:
           │   tm_pc_home_quote_grab_payload_v1
           │   tm_pc_auto_quote_grab_payload_v1
           │   tm_pc_webhook_bundle_v1
           ▼
┌─────────────────────────┐
│ Webhook Submission V1.9 │  POSTs one consolidated bundle to Pabbly
└─────────────────────────┘
```

## Scripts (22 total)

### AgencyZoom

| Script | Purpose |
|---|---|
| **AZ TO GWPC 01 AZ Stage Runner + AZ Payload Grabber V2.3** | Opens pipeline tickets one-by-one. Validates 13 AZ fields. Clicks Auto or Home link. Waits for "Bot Quoted" tag before advancing. Writes shared job state. |
| **AZ TO GWPC Shared Ticket Handoff V1.0** | Captures Ticket ID + Name + Mailing Address on AZ side; on GWPC side, matches by name + address and writes `tm_pc_current_job_v1`. |

### Salesforce Lightning (APEX)

| Script | Purpose |
|---|---|
| **Home Bot: APEX Quote New Account V3.9** | **Dormant.** Reads `tm_apex_home_bot_payload_v1` (not currently populated by any script in this repo). Kept installed for when webhook-seeded APEX form-fill is wired up. |
| **Home Bot: APEX Duplicates Continue V1.8** | Handles the Duplicates Found modal: selects first match, waits for Continue to enable, clicks it. |
| **Home Bot: APEX Continue New Quote V1.8** | Handles the Personal Lines Quote modal: clicks Home, picks Residence Address, clicks Continue New Quote once. |
| **Home Bot: APEX Inactivity Reload Failsafe V1.1** | Reloads the page if no real activity for 60s. |

### Guidewire PolicyCenter

| Script | Purpose |
|---|---|
| **01 GWPC Start Auto Quote V1.6** | Waits for Current Activities, reloads once, clicks Start New Submission, picks Personal Auto. |
| **Home Bot: Guidewire Policy Info V1.9** | Policy Info tab. Branches on Personal Auto presence. Handles Non-Binary/Flex gender error by switching to Male. DT2 Next retry. |
| **Home Bot: Guidewire Disclosure Qualification V1.9** | Clicks Yes on all disclosure questions, including extra Personal Auto Yes radios. DT2 Next retry. Hard-stops if already quoted. |
| **1) AQB - Auto Data Prefill → Drivers Only** | Driver info: dropdowns, Gender, DOB (26–50), Age Lic (16–22). Sets `aqb_step_drivers_done=1`. |
| **2) AQB - Auto Data Prefill → Vehicles Only** | Waits for `drivers_done`. Removes incomplete vehicle rows. Sets Primary Driver. Sets `aqb_step_vehicles_done=1` + `aqb_step_specialty_start=1`. |
| **03 AQB - Specialty Product → Remove if needed, then Quote** | Waits for `specialty_start`. Removes specialty rows if present. Clicks Quote with up to 3 retries. Sets `aqb_step_specialty_done=1`. |
| **Home Bot: Dwelling Water Rule V3.0** | Dwelling step. Optional Create Valuation + Plumbing Replaced. Year Built water-device rule. Fixes Garage Type after first Quote failure. |
| **04 GWPC Home Coverages Quote + Risk Analysis V1.0.9** | Edit All → apply coverage changes → Quote → Risk Analysis. |
| **Home Bot: Home Quote Grabber V1.8** | After Submission (Quoted), scrapes home quote fields from Dwelling/Coverages/Quote and saves `tm_pc_home_quote_grab_payload_v1`. |
| **AZ TO GWPC Home Bot: Auto Quote Grabber V2.4** | After Submission (Quoted), navigates Policy Info → Drivers → Vehicles → PA Coverages → Quote, scrapes auto quote fields, saves webhook-ready payload and bundle. |
| **AZ TO GWPC Home Bot: Webhook Submission V1.9** | Waits for handoff + payloads, POSTs one consolidated bundle to the configured webhook URL (Pabbly). Blocks infinite retry loops. |
| **Home Bot: GWPC Discard Unsaved Change Clicker V1.0** | Auto-dismisses the "Discard Unsaved Change" dialog whenever it appears. |

### Cross-origin utilities

| Script | Purpose |
|---|---|
| **AZ + APEX + GWPC Storage Tools (Export Payloads + Clear + Close) V1.4** | Floating panel per origin: exports tracked storage to TXT, clears tracked keys, closes the tab. |
| **Home Bot: Global Clear Launcher V1.0** | One-click fan-out: opens AZ + APEX + GWPC tabs, each clears its own storage. |
| **Home Bot: Clean All → Refresh → Home V1.3** | APEX → GWPC refresh cycle: opens cleaner tab, waits, clears keys, closes. |
| **Home Bot: UI Dock Organizer V1.3** | Organizes floating UIs inside the viewport so they don't overlap. |

## Storage key conventions

| Prefix | Owner / purpose |
|---|---|
| `tm_az_*` | AgencyZoom side state (payloads, panel position, running flag). |
| `tm_apex_*` | APEX-side script state. |
| `tm_pc_*` | GWPC-side state: quote payloads, current job, webhook bundle + metadata. |
| `tm_shared_az_job_v1`, `tm_shared_cache_*` | Shared state readable across origins (via Tampermonkey GM storage). |
| `hb_*` | Home Bot inter-script flags (handoff signals, clear-workflow coordination). |
| `aqb_step_*` | AQB sequencer gates (Drivers → Vehicles → Specialty). |

## Development

- All scripts live in `files/*.user.js`.
- **PII dumps (`*.storage.json`, `*.options.json`) are gitignored** — Tampermonkey
  export files contain real customer data and must never be committed. See
  `.gitignore`.
- **Data source is a webhook (Pabbly intake, in development).** APEX Quote New
  Account V3.9 is kept dormant so the form-fill slot is ready when the
  webhook-to-APEX adapter is built.

## Install & auto-update

Scripts ship with `@updateURL` + `@downloadURL` pointing at raw GitHub. See
[`UPDATE.md`](UPDATE.md) for install links, update-interval configuration,
and the developer version-bump rule.

## Operator install notes

Tampermonkey treats changes to `@name` or `@namespace` as new scripts. After
pulling a renamed or version-bumped script, either:

- Remove the old entry in Tampermonkey and install the new file, or
- Manually edit the installed script's header to match.

Orphaned localStorage values from previous installs will not be read by the
renamed scripts. Run the Storage Tools clear once (it sweeps `tm_*`, `hb_*`,
and `aqb_*` prefixes) to wipe them.
