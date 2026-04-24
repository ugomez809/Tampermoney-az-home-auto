# Install & Update Guide

Every script in this repo is a Tampermonkey userscript with `@updateURL` and
`@downloadURL` pointing at the raw GitHub URL for that file. After a one-time
install from the links below, Tampermonkey will check for new versions
automatically (default every ~7 days; see [Configure update interval](#configure-update-interval)).

Filenames are stable ASCII IDs — they will not change again. Only the `@version`
header moves when a script is updated.

## One-time install

If you had an earlier install of any of these scripts (filename contained a
version like `V1.9` or mixed-case / special characters), **remove the old entries
from the Tampermonkey dashboard first**. Tampermonkey identifies scripts by
`@name` + `@namespace`, both of which changed in this release, so the new
install will not overwrite the old one — you'll end up with duplicates.

For each script:

1. Open the **Install** link in a browser where Tampermonkey is active.
2. Tampermonkey opens its install page showing the script metadata.
3. Click **Install**.

### AgencyZoom

| Script | Install |
| --- | --- |
| AZ TO GWPC 01 AZ Stage Runner + AZ Payload Grabber | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-stage-runner.user.js) |
| AZ TO GWPC Shared Ticket Handoff | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-ticket-handoff.user.js) |
| AZ TO GWPC 100 AgencyZoom Ticket Finisher + Tagger | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-ticket-finisher-tagger.user.js) |

### Salesforce Lightning (APEX)

| Script | Install |
| --- | --- |
| Home Bot: APEX Quote New Account | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-quote-new-account.user.js) |
| Home Bot: APEX Duplicates Continue | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-duplicates-continue.user.js) |
| Home Bot: APEX Continue New Quote | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-continue-new-quote.user.js) |
| Home Bot: APEX Inactivity Reload Failsafe | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-inactivity-reload.user.js) |

### Guidewire PolicyCenter

| Script | Install |
| --- | --- |
| 01 GWPC Start Auto Quote | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-start-auto-quote.user.js) |
| Home Bot: Guidewire Policy Info | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-policy-info.user.js) |
| Home Bot: Guidewire Disclosure Qualification | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-disclosure-qualification.user.js) |
| 1) AQB - Auto Data Prefill → Drivers Only (Go-Ahead Flag) | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-drivers.user.js) |
| 2) AQB - Auto Data Prefill → Vehicles Only (listens to drivers flag) | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-vehicles.user.js) |
| 03 AQB - Specialty Product → Remove if needed, then Quote | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-specialty-product.user.js) |
| Home Bot: Dwelling Water Rule | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/dwelling-water-rule.user.js) |
| 04 GWPC Home Coverages Quote + Risk Analysis | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-home-coverages-risk-analysis.user.js) |
| Home Bot: Home Quote Grabber | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js) |
| Home Bot: Auto Quote Grabber | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/auto-quote-grabber.user.js) |
| AZ TO GWPC Home Bot: Webhook Submission | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/webhook-submission.user.js) |
| Home Bot: GWPC Discard Unsaved Change Clicker | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-discard-unsaved-change.user.js) |
| Home Bot: Guidewire Header Timeout | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-header-timeout.user.js) |
| GWPC Popup Blocker | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-popup-blocker.user.js) |

### Cross-origin utilities

| Script | Install |
| --- | --- |
| AZ + APEX + GWPC Storage Tools (Export Payloads + Clear + Close) | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/storage-tools.user.js) |
| Home Bot: Global Clear Launcher | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/global-clear-launcher.user.js) |
| Home Bot: Clean All → Refresh → Home | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/clean-refresh-home.user.js) |
| Home Bot: UI Dock Organizer | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/ui-dock-organizer.user.js) |
| AZ TO GWPC 99 Payload Mirror + Non-AZ Tab Closer | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js) |

## How auto-update works

Tampermonkey polls each installed script's `@updateURL` on a schedule. If the
remote `@version` is higher than the installed `@version`, Tampermonkey fetches
`@downloadURL` and silently replaces the script. The new version takes effect
on the next page load.

## Configure update interval

Default is ~7 days. To check more often:

1. Tampermonkey icon → **Dashboard** → **Settings** tab.
2. Scroll to **Externals** → set **Update interval** to `Every day` (or shorter).
3. You can also force a check now: Dashboard → **Installed Userscripts** tab →
   click the refresh icon next to each script, or use **Check for userscript updates**
   at the top.

## For developers

### House rules

1. **Every change to a script must bump `@version`**, or operators will not
   receive the update. Tampermonkey compares versions using semver-like rules
   (e.g. `3.9` < `3.9.1` < `3.10`). Patch-level bumps are fine.
2. **Never put the version number in the filename, `@name`, or `@namespace`.**
   Version numbers belong in `@version` only. Embedding them anywhere else
   creates drift or forces a rename on every bump, which orphans installs.
3. **Never rename a file, `@name`, or `@namespace` after install.** Any of those
   changes orphans operator installs silently — Tampermonkey's `@updateURL` lookup
   returns 404, the operator stops receiving updates with no error surfaced.

### Release workflow

```
1. Edit files/<stable-id>.user.js
2. Bump the @version header in that file (only that header — not @name,
   not @namespace, not the filename)
3. git commit + git push origin main
4. Operators receive the update on their next Tampermonkey poll
```

## Troubleshooting

**"The update never arrived."** Check in order:

1. Was `@version` bumped in the commit that changed the script? If not, no update.
2. Is the operator still running an older install (from before the filename rename)?
   They need the one-time reinstall from this page.
3. Has Tampermonkey actually polled recently? Force a check from the Dashboard.
4. Is the raw URL reachable from the operator's machine? Paste it in a browser
   tab; should return the raw script text.

**"I see two copies of the same script in my Tampermonkey dashboard."** You have
an old install alongside the new one. Remove the old entry.
