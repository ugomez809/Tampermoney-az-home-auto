# Portable quoting installer source

This directory contains the installer and monitoring source used by the private
Windows migration ZIP. The ZIP carries the installed Node/Playwright/Chromium
runtime, Tampermonkey and the current persistent profile. Browser credentials,
cookies, customer data, profile keys and per-user manifests are deliberately
excluded from this repository.

In the complete private ZIP, extract all files to a permanent local folder and
run `INSTALL.bat` as administrator. Installation resolves the signed-in desktop
user, migrates the profile key under that account, installs the unpacked extension
through Chrome's persistent installation flow, restores any required script
approvals through the normal editor, and verifies two browser restarts. The
five-minute/logon Windows check and the three-minute inactivity supervisor run
without elevation.

All script sources, stored GM data, enabled choices and automatic-update flags
are verified against the private snapshot manifest. Reinstalling in the same
folder preserves the current profile, including subsequent GitHub updates and
storage changes. Failed installation leaves the job paused.

Normal startup requires the persistent extension at this installation's path;
it does not use a temporary load that would invalidate script approvals later.

For development, `monitor-config.example.json` shows the timing configuration.
Tests use private local fixtures or synthetic data, not production websites.
With Node and Playwright installed, the pure and DOM tests can be run with:

```
node --test watchdog.test.cjs monitor-browser.test.cjs startup-tabs.test.cjs launch-startup.test.cjs verify-tampermonkey.test.cjs
```

Integration tests require the bundled Windows runtime/browser and a private
profile fixture. They create their own installation paths and scheduled tasks.
`Build-Package.ps1` creates and validates a complete migration archive from a
stopped installation, preserving credentials locally and producing a SHA-256
manifest for every file. The public userscript-only bundle remains under
`bundles/`; it contains no private profile.
