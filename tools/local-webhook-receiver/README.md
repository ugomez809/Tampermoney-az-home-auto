# Local GWPC Webhook Receiver

This helper receives the `GWPC Webhook Submission` payload on your own PC and saves each payload as a `.txt` file.

It listens only on `127.0.0.1`, so it is local to the computer running it.

## Start It

Use the default folder:

```powershell
tools\local-webhook-receiver\start-local-webhook.cmd
```

Use a specific folder:

```powershell
tools\local-webhook-receiver\start-local-webhook.cmd -OutputDir "C:\Users\JKira26\Documents\GWPC Payloads"
```

The webhook URL to paste into the `GWPC Webhook Submission` panel is:

```text
http://127.0.0.1:8787/gwpc-payload
```

Click `TEST` in the script panel to verify a `.txt` file appears in the output folder.

## Receive From Another PC / Network

Use the public helper on your desktop:

```powershell
tools\local-webhook-receiver\start-public-webhook.cmd -OutputDir "C:\Users\JKira26\Documents\Work\Webhooks\Home"
```

It starts the local receiver, downloads Cloudflare's `cloudflared.exe` if needed, opens a temporary HTTPS tunnel, and prints a token-protected public URL.

Paste the printed URL into the other PC's `GWPC Webhook Submission` panel. It will look like:

```text
https://example.trycloudflare.com/gwpc-payload?token=YOUR_TOKEN
```

Keep the public helper window open. If you close it, the URL stops working. Cloudflare quick-tunnel URLs usually change every time you restart the helper.

## Stop It

Press `Ctrl+C` in the receiver window.

## Notes

- Keep the output folder outside this repo because payloads may include customer data.
- Each PC needs its own receiver running if you want local saving on multiple machines.
- If Windows reports access denied when starting the listener, try another port with `-Port 8790`, or start PowerShell as Administrator once.
