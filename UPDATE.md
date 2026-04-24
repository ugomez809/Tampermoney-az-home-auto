# Install & Update Guide

Every script in this repo is a Tampermonkey userscript with `@updateURL` and
`@downloadURL` pointing at the raw GitHub URL for that file. After a one-time
install from the links below, Tampermonkey will check for new versions
automatically (default every ~7 days; see [Configure update interval](#configure-update-interval)).

Filenames are stable ASCII IDs - they will not change again. Only the `@version`
header moves when a script is updated.

## One-time install

### Full wipe reinstall bundle

If you're doing a full Tampermonkey wipe and want the renamed dashboard list in one shot, use the bundle below instead of clicking 23 install links one by one.

- [Download full reinstall bundle](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/bundles/tampermonkey-full-reinstall-bundle.zip)

Import steps:

1. Tampermonkey Dashboard -> `Utilities`
2. `Import from file`
3. Choose `tampermonkey-full-reinstall-bundle.zip`
4. Review the import list and confirm

If you had an earlier install of any of these scripts, remove the old entries
from the Tampermonkey dashboard first. Tampermonkey identifies scripts by
`@name` + `@namespace`, so renamed dashboard entries will not overwrite the old
ones automatically.

For one-by-one installs instead of the bundle:

1. Open the **Install** link in a browser where Tampermonkey is active.
2. Tampermonkey opens its install page showing the script metadata.
3. Click **Install**.

### AgencyZoom

| Script | Install |
| --- | --- |
| AgencyZoom Quote Launcher + Payload Grabber | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-stage-runner.user.js) |
| GWPC Shared Ticket Handoff | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-ticket-handoff.user.js) |
| AgencyZoom Ticket Finisher + Tagger | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-ticket-finisher-tagger.user.js) |

### Salesforce Lightning (APEX)

| Script | Install |
| --- | --- |
| APEX Duplicate Check Continue | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-duplicates-continue.user.js) |
| APEX Home Quote Continue | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-continue-new-quote.user.js) |

### Guidewire PolicyCenter

| Script | Install |
| --- | --- |
| GWPC Auto Quote Starter | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-start-auto-quote.user.js) |
| GWPC Policy Info Prefill | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-policy-info.user.js) |
| GWPC Disclosure Qualification | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-disclosure-qualification.user.js) |
| GWPC Auto Drivers Prefill | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-drivers.user.js) |
| GWPC Auto Vehicles Prefill | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-vehicles.user.js) |
| GWPC Auto Specialty Quote | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-specialty-product.user.js) |
| GWPC Dwelling Water Rule | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/dwelling-water-rule.user.js) |
| GWPC Home Coverages + Risk Analysis | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-home-coverages-risk-analysis.user.js) |
| GWPC Home Quote Extractor | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js) |
| GWPC Auto Quote Extractor | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/auto-quote-grabber.user.js) |
| GWPC Webhook Submission | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/webhook-submission.user.js) |
| GWPC Unsaved Change Discard Clicker | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-discard-unsaved-change.user.js) |
| GWPC Header Timeout Monitor | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-header-timeout.user.js) |
| GWPC Popup Blocker | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-popup-blocker.user.js) |

### Cross-origin utilities

| Script | Install |
| --- | --- |
| Cross-Origin Storage Tools | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/storage-tools.user.js) |
| Cross-Origin Global Clear Launcher | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/global-clear-launcher.user.js) |
| Cross-Origin UI Dock Organizer | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/ui-dock-organizer.user.js) |
| GWPC Payload Mirror + Non-AZ Tab Closer | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js) |

## How auto-update works

Tampermonkey polls each installed script's `@updateURL` on a schedule. If the
remote `@version` is higher than the installed `@version`, Tampermonkey fetches
`@downloadURL` and silently replaces the script. The new version takes effect
on the next page load.

## Configure update interval

Default is ~7 days. To check more often:

1. Tampermonkey icon -> **Dashboard** -> **Settings** tab.
2. Scroll to **Externals** -> set **Update interval** to `Every day` (or shorter).
3. You can also force a check now: Dashboard -> **Installed Userscripts** tab ->
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
   changes orphans operator installs silently - Tampermonkey's `@updateURL` lookup
   returns 404, the operator stops receiving updates with no error surfaced.

### Release workflow

```
1. Edit files/<stable-id>.user.js
2. Bump the @version header in that file (only that header - not @name,
   not @namespace, not the filename)
3. git commit + git push origin main
4. Operators receive the update on their next Tampermonkey poll
```

## Troubleshooting

**"The update never arrived."** Check in order:

1. Was `@version` bumped in the commit that changed the script? If not, no update.
2. Is the operator still running an older install? They need the one-time reinstall
   from this page after the rename rollout.
3. Has Tampermonkey actually polled recently? Force a check from the Dashboard.
4. Is the raw URL reachable from the operator's machine? Paste it in a browser
   tab; should return the raw script text.

**"I see two copies of the same script in my Tampermonkey dashboard."** You have
an old install alongside the renamed one. Remove the old entry.
