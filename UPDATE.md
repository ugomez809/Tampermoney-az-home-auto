# Install & Update Guide

Every script in this repo is a Tampermonkey userscript with `@updateURL` and
`@downloadURL` pointing at the raw GitHub URL for that file. After a one-time
install from the links below, Tampermonkey will check for new versions
automatically (default every ~7 days; see [Configure update interval](#configure-update-interval)).

## One-time install

For each script:

1. Open the **Install** link in a browser where Tampermonkey is active.
2. Tampermonkey opens its install page showing the script metadata.
3. Click **Install** (or **Reinstall** if you had a prior version — this is expected).

If you had older LEX-named or V1.3-tagged versions installed previously,
**remove those first** from the Tampermonkey dashboard. The new versions have
different `@name` / `@namespace` and will not overwrite the old ones.

### AgencyZoom

| Script | Install |
| --- | --- |
| AZ TO GWPC 01 AZ Stage Runner + AZ Payload Grabber V2.3 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/AZ%20TO%20GWPC%2001%20AZ%20Stage%20Runner%20%2B%20AZ%20Payload%20Grabber%20V2.3.user.js) |
| AZ TO GWPC Shared Ticket Handoff V1.0 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/AZ%20TO%20GWPC%20Shared%20Ticket%20Handoff%20V1.0.user.js) |

### Salesforce Lightning (APEX)

| Script | Install |
| --- | --- |
| Home Bot: APEX Quote New Account V3.9 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20APEX%20Quote%20New%20Account%20V3.9.user.js) |
| Home Bot: APEX Duplicates Continue V1.8 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20APEX%20Duplicates%20Continue%20V1.8.user.js) |
| Home Bot: APEX Continue New Quote V1.8 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20APEX%20Continue%20New%20Quote%20V1.8.user.js) |
| Home Bot: APEX Inactivity Reload Failsafe V1.1 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20APEX%20Inactivity%20Reload%20Failsafe%20V1.1.user.js) |

### Guidewire PolicyCenter

| Script | Install |
| --- | --- |
| 01 GWPC Start Auto Quote V1.6 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/01%20GWPC%20Start%20Auto%20Quote%20V1.6.user.js) |
| Home Bot: Guidewire Policy Info V1.9 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Guidewire%20Policy%20Info%20V1.9.user.js) |
| Home Bot: Guidewire Disclosure Qualification V1.9 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Guidewire%20Disclosure%20Qualification%20V1.9.user.js) |
| 1) AQB - Auto Data Prefill → Drivers Only (Go-Ahead Flag) | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/1%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Drivers%20Only%20%28Go-Ahead%20Flag%29.user.js) |
| 2) AQB - Auto Data Prefill → Vehicles Only (listens to drivers flag) | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/2%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Vehicles%20Only%20%28listens%20to%20drivers%20flag%29.user.js) |
| 03 AQB - Specialty Product → Remove if needed, then Quote | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/03%20AQB%20-%20Specialty%20Product%20%E2%86%92%20Remove%20if%20needed%2C%20then%20Quote.user.js) |
| Home Bot: Dwelling Water Rule V3.0 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Dwelling%20Water%20Rule%20V3.0.user.js) |
| 04 GWPC Home Coverages Quote + Risk Analysis V1.0.9 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/04%20GWPC%20Home%20Coverages%20Quote%20%2B%20Risk%20Analysis%20V1.0.9.user.js) |
| Home Bot: Home Quote Grabber V1.8 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Home%20Quote%20Grabber%20V1.8.user.js) |
| AZ TO GWPC Home Bot: Auto Quote Grabber V2.4 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/AZ%20TO%20GWPC%20Home%20Bot_%20Auto%20Quote%20Grabber%20V2.4.user.js) |
| AZ TO GWPC Home Bot: Webhook Submission V1.9 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/AZ%20TO%20GWPC%20Home%20Bot_%20Webhook%20Submission%20V1.9.user.js) |
| Home Bot: GWPC Discard Unsaved Change Clicker V1.0 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20GWPC%20Discard%20Unsaved%20Change%20Clicker%20V1.0.user.js) |

### Cross-origin utilities

| Script | Install |
| --- | --- |
| AZ + APEX + GWPC Storage Tools (Export Payloads + Clear + Close) V1.4 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/AZ%20%2B%20APEX%20%2B%20GWPC%20Storage%20Tools%20%28Export%20Payloads%20%2B%20Clear%20%2B%20Close%29%20V1.4.user.js) |
| Home Bot: Global Clear Launcher V1.0 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Global%20Clear%20Launcher%20V1.0.user.js) |
| Home Bot: Clean All → Refresh → Home V1.3 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Clean%20All%20%E2%86%92%20Refresh%20%E2%86%92%20Home%20V1.3.user.js) |
| Home Bot: UI Dock Organizer V1.3 | [Install](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20UI%20Dock%20Organizer%20V1.3.user.js) |

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

**Every change to a script must bump `@version`**, or operators will not receive
the update. Tampermonkey compares versions using semver-like rules (e.g. `3.9` <
`3.9.1` < `3.10`). Patch-level bumps are fine.

**Do not rename a file, `@name`, or `@namespace` after install.** Any of those
changes orphans existing installs silently — operators stop receiving updates
without knowing. Pick names and stay put.

Workflow:

```
1. Edit files/<script>.user.js
2. Bump the @version header in that file
3. git commit + git push origin main
4. Operators receive the update on their next Tampermonkey poll
```

## Troubleshooting

**"The update never arrived."** Check in order:

1. Was `@version` bumped in the commit that changed the script? If not, no update.
2. Is the operator still running a pre-auto-update install (no `@updateURL` in
   their copy)? They need the one-time reinstall from this page.
3. Has Tampermonkey actually polled recently? Force a check from the Dashboard.
4. Is the raw URL reachable from the operator's machine? Paste it in a browser
   tab; should return the raw script text.

**"I see two copies of the same script in my Tampermonkey dashboard."** You have
an old install (LEX-named or V1.3) alongside the new one. Remove the old entry.
