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
│ AZ Stage Runner         │  picks tickets, validates 13 fields
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
│  Start Auto Quote  →  Policy Info  →  Disclosure                │
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
│ Webhook Submission      │  POSTs one consolidated bundle to Pabbly
└─────────────────────────┘
```

## Scripts (24 total)

### AgencyZoom

| File | Purpose |
|---|---|
| `az-stage-runner.user.js` | Opens pipeline tickets one-by-one. Validates 13 AZ fields. Clicks Auto or Home link. Waits for "Bot Quoted" tag before advancing. Writes shared job state. |
| `shared-ticket-handoff.user.js` | Captures Ticket ID + Name + Mailing Address on AZ side; on GWPC side, matches by name + address and writes `tm_pc_current_job_v1`. |

### Salesforce Lightning (APEX)

| File | Purpose |
|---|---|
| `apex-quote-new-account.user.js` | **Dormant.** Reads `tm_apex_home_bot_payload_v1` (not currently populated by any script in this repo). Kept installed for when webhook-seeded APEX form-fill is wired up. |
| `apex-duplicates-continue.user.js` | Handles the Duplicates Found modal: selects first match, waits for Continue to enable, clicks it. |
| `apex-continue-new-quote.user.js` | Handles the Personal Lines Quote modal: clicks Home, picks Residence Address, clicks Continue New Quote once. |
| `apex-inactivity-reload.user.js` | Reloads the page if no real activity for 60s. |

### Guidewire PolicyCenter

| File | Purpose |
|---|---|
| `gwpc-start-auto-quote.user.js` | Waits for Current Activities, reloads once, clicks Start New Submission, picks Personal Auto. |
| `gwpc-policy-info.user.js` | Policy Info tab. Branches on Personal Auto presence. Handles Non-Binary/Flex gender error by switching to Male. DT2 Next retry. |
| `gwpc-disclosure-qualification.user.js` | Clicks Yes on all disclosure questions, including extra Personal Auto Yes radios. DT2 Next retry. Hard-stops if already quoted. |
| `aqb-drivers.user.js` | Driver info: dropdowns, Gender, DOB (26–50), Age Lic (16–22). Sets `aqb_step_drivers_done=1`. |
| `aqb-vehicles.user.js` | Waits for `drivers_done`. Removes incomplete vehicle rows. Sets Primary Driver. Sets `aqb_step_vehicles_done=1` + `aqb_step_specialty_start=1`. |
| `aqb-specialty-product.user.js` | Waits for `specialty_start`. Removes specialty rows if present. Clicks Quote with up to 3 retries. Sets `aqb_step_specialty_done=1`. |
| `dwelling-water-rule.user.js` | Dwelling step. Optional Create Valuation + Plumbing Replaced. Year Built water-device rule. Fixes Garage Type after first Quote failure. |
| `gwpc-home-coverages-risk-analysis.user.js` | Edit All → apply coverage changes → Quote → Risk Analysis. |
| `home-quote-grabber.user.js` | After Submission (Quoted), scrapes home quote fields from Dwelling/Coverages/Quote and saves `tm_pc_home_quote_grab_payload_v1`. |
| `gwpc-header-timeout.user.js` | Watches Guidewire header/product state, posts timeout or no-vehicle results to the configured endpoints, then closes the tab. |
| `gwpc-popup-blocker.user.js` | Utility support script that suppresses alert/confirm/prompt and beforeunload blockers across all 3 PolicyCenter hosts. |
| `auto-quote-grabber.user.js` | After Submission (Quoted), navigates Policy Info → Drivers → Vehicles → PA Coverages → Quote, scrapes auto quote fields, saves shared AUTO payload and bundle data only. |
| `webhook-submission.user.js` | Waits for handoff + payloads, POSTs one consolidated bundle to the configured webhook URL (Pabbly). Blocks infinite retry loops. |
| `gwpc-discard-unsaved-change.user.js` | Auto-dismisses the "Discard Unsaved Change" dialog whenever it appears. |

### Cross-origin utilities

| File | Purpose |
|---|---|
| `storage-tools.user.js` | Floating panel per origin: exports tracked storage to TXT, clears tracked keys, closes the tab. |
| `global-clear-launcher.user.js` | One-click fan-out: opens AZ + APEX + GWPC tabs, each clears its own storage. |
| `clean-refresh-home.user.js` | APEX → GWPC refresh cycle: opens cleaner tab, waits, clears keys, closes. |
| `ui-dock-organizer.user.js` | Organizes floating UIs inside the viewport so they don't overlap. |

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

- All scripts live in `files/*.user.js`. **Filenames are stable IDs — do not rename.**
  Version numbers live only in the `@version` header.
- **PII dumps (`*.storage.json`, `*.options.json`) are gitignored** — Tampermonkey
  export files contain real customer data and must never be committed. See
  `.gitignore`.
- **Data source is a webhook (Pabbly intake, in development).** APEX Quote New
  Account is kept dormant so the form-fill slot is ready when the webhook-to-APEX
  adapter is built.

## Install & auto-update

Scripts ship with `@updateURL` + `@downloadURL` pointing at raw GitHub. See
[`UPDATE.md`](UPDATE.md) for install links, update-interval configuration,
and the developer version-bump rule.

## Developer rules (read before touching a script)

1. **Bump `@version` on every change** — Tampermonkey won't update operators otherwise.
2. **Never put the version in the filename, `@name`, or `@namespace`.** Versions
   live only in `@version`.
3. **Never rename** a file, `@name`, or `@namespace` after it's installed. Doing
   so orphans every operator's install silently.
