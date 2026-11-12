# AgencyZoom Chrome watchdog (Windows)

Use this package on the other PC. It does not install a task on the PC where the package was prepared.

## One-time setup

1. Install Google Chrome and [Node.js 24 LTS](https://nodejs.org/). Node 22+ works; no npm packages are needed.
2. Extract this entire folder to a permanent location such as `Documents\AgencyZoomWatchdog`. Do not run it from inside the ZIP or move it after installing the task.
3. Double-click **1-open-browser.bat**. This opens a normal, visible Chrome window using the dedicated data directory `%LOCALAPPDATA%\AgencyZoomWatchdog\Chrome`, profile `Default`.
4. In THAT window, sign in to AgencyZoom, install Tampermonkey from the Chrome Web Store, and install/update the [Zillow userscript](https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-zillow-ticket-enricher.user.js). Confirm version **1.4.33 or later**. Configure the field/tag targets and optional webhook just as on the working PC. Existing Chrome profiles, cookies, extensions, and Tampermonkey settings are not copied.
5. Confirm the script is working, then double-click **2-install-task.bat** under the Windows account that will run it. Administrator access is not needed. Leave that Windows account signed in. The first scheduled check is five minutes later.

The task runs **run.bat every five minutes**, plus at Windows logon. Its console stays hidden; Chrome remains visible. It does not run while the account is signed out or the PC is asleep/off. Turn off sleep through normal Windows settings if unattended operation requires it.

## Checks and recovery

- Detects only Chrome launched with this dedicated data directory and exact executable path.
- If closed, opens it at `https://app.agencyzoom.com/referral/pipeline`.
- Reads the AgencyZoom and Zillow tabs through Chrome's local debugging interface. Logs page URLs, focused-tab flags, document load state, script status, ticket ID, the latest completed-ticket log entry, and a hash of form values. Field values, passwords, cookies, and full page text are not written to the watchdog log.
- The first healthy check establishes a baseline. On the next check, if AgencyZoom's ticket, status, field hash, and completion marker are unchanged, it fully restarts the dedicated browser. Countdown changes and background log timestamps do not count as progress.
- A missing AgencyZoom page, unloaded document, missing/stopped userscript, or failed browser inspection also triggers restart. A browser younger than 90 seconds gets time to load. As requested, an unchanged empty queue will also cause a restart.
- It first asks the dedicated browser to close, waits five seconds, then force-closes only its verified process tree if necessary. This can discard an unsaved ticket. Other Chrome profiles are not targeted.
- A restart clears the comparison baseline. Login and CAPTCHA checks can still require a person; restarting does not solve them or guarantee successful quoting.

The log is `%LOCALAPPDATA%\AgencyZoomWatchdog\watchdog.jsonl`; the previous log is retained when it reaches 10 MB. The last comparison is in `state.json` beside it. These contain local ticket identifiers and property URLs: keep them private.

Chrome's debugging port is random and bound to loopback. The launcher verifies that its dedicated Chrome process owns that port before connecting. This interface can control the dedicated browser, so use that profile only for this automation. Modern Chrome requires a separate user-data directory for this interface: [Chrome documentation](https://developer.chrome.com/blog/remote-debugging-port).

## Stop or remove

Double-click **uninstall-task.bat** before stopping the userscript for maintenance. It removes the scheduled task and keeps the profile, login session, and logs. Reinstall using `2-install-task.bat` when ready. Closing Chrome or pressing STOP alone is temporary while the watchdog task is installed.

## Validation

Run `node --test check.test.cjs` and `powershell -NoProfile -File watchdog.test.ps1`. These checks do not close a real browser or install a task. Live login, Tampermonkey permissions, and Scheduled Task execution must be verified on the destination PC.
