# Farmers SAML Real-Click Helper

Small AutoHotkey v2 helper for the `eagentsaml.farmersinsurance.com` sign-in page.

This does not inspect the DOM. It performs a real OS-level mouse click at one saved
point inside the active Farmers sign-in browser window.

## What it does

- Watches the active Chromium browser window.
- Reads the active browser URL by copying the address bar, then checks for
  `https://eagentsaml.farmersinsurance.com/`.
- If the active browser tab URL matches, it clicks a saved point every `10s`.
- Lets you bind the page click point once by pressing `F7` and then clicking
  anywhere on the Farmers page manually.
- Lets you send a real click immediately with `F8`.
- Lets you pause or resume with `F9`.

## Files

- `eagentsaml-clicker.ahk`: main AutoHotkey v2 script
- `eagentsaml-clicker.ini`: URL filter, click point, and timing
- `start-clicker.cmd`: launcher that looks for AutoHotkey v2

## Setup

1. Install AutoHotkey v2.
2. Run [start-clicker.cmd](./start-clicker.cmd).
3. Open `https://eagentsaml.farmersinsurance.com/`.
4. Press `F7`.
5. Click anywhere on the Farmers page once. That saves the point as a relative position.
6. Leave the script running.

## Hotkeys

- `F11`: bind the page click point from your next click
- `F12`: click the saved point now
- `Pause`: pause or resume
- `Ctrl+Alt+F11/F12/Pause`: fallback versions if the plain keys conflict

## Notes

- The helper only clicks when the active window class matches `Chrome_WidgetWin_1`
  and the copied address bar URL contains `https://eagentsaml.farmersinsurance.com/`.
- The default click point in the INI is only a placeholder. Binding the real
  page point with `F7` is the intended path.
- Because this reads the address bar, it briefly selects the browser URL every poll.
