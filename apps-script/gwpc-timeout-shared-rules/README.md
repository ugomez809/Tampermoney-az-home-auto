# GWPC Timeout Shared Rules Apps Script

This Apps Script web app stores the timeout script's saved selector/error rules in one shared Google Sheet so multiple computers can read the same rules.

The script is already configured for:

- Spreadsheet ID: `151rbB6RHol3o53Ic9p1a-6QwEivdC640ePWhK2AU824`
- Sheet tab: `Sheet1`

You can leave `Sheet1` empty. The script will create the header row automatically on first use.

## Sheet Columns

The web app writes these columns:

1. `ruleId`
2. `enabled`
3. `label`
4. `savedErrorText`
5. `selector`
6. `fingerprintJson`
7. `createdAt`
8. `updatedAt`
9. `sourceScript`
10. `sourceVersion`
11. `updatedBy`
12. `clientId`

## Shared Key

This scaffold already includes a generated shared key:

- `gwpc-timeout-rules-24apr2026-jkira-91x7p`

You do not need to change it unless you want a different one.

## Deploy Steps

1. Open [script.new](https://script.new) or a new Apps Script project.
2. Replace the default `Code.gs` contents with [Code.gs](C:/Users/JKira26/Desktop/Tampermoney-az-home-auto/apps-script/gwpc-timeout-shared-rules/Code.gs).
3. Open `Project Settings` and, if you want, replace the manifest with [appsscript.json](C:/Users/JKira26/Desktop/Tampermoney-az-home-auto/apps-script/gwpc-timeout-shared-rules/appsscript.json).
4. Save the project.
5. Run any function once from the editor so Google asks for authorization.
6. Deploy as a Web App.
7. Recommended deploy settings:
   - Execute as: `Me`
   - Who has access: `Anyone`
8. Copy the Web App URL and send it here.

Official references:

- [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web?hl=en)
- [Apps Script Deployments](https://developers.google.com/apps-script/concepts/deployments)
- [SpreadsheetApp Reference](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app)

## API Shape

### GET active rules

Query string:

- `action=listRules`
- `key=<shared key>`

Example:

```text
https://SCRIPT_URL?action=listRules&key=gwpc-timeout-rules-24apr2026-jkira-91x7p
```

### GET all rules including disabled

Query string:

- `action=listRules`
- `key=<shared key>`
- `includeDisabled=true`

### POST upsert rule

```json
{
  "action": "upsertRule",
  "key": "gwpc-timeout-rules-24apr2026-jkira-91x7p",
  "rule": {
    "ruleId": "rule_abc123",
    "label": "Garage type mismatch",
    "savedErrorText": "Garage type mismatch",
    "selector": "#some-selector",
    "fingerprint": {
      "tag": "div",
      "id": "",
      "name": "",
      "role": "",
      "ariaLabel": "",
      "classTokens": ["gw-label"],
      "textFingerprint": "Garage type mismatch"
    },
    "sourceScript": "GWPC Header Timeout Monitor",
    "sourceVersion": "2.3.4",
    "updatedBy": "JKira",
    "clientId": "pc-01"
  }
}
```

### POST disable rule

```json
{
  "action": "disableRule",
  "key": "gwpc-timeout-rules-24apr2026-jkira-91x7p",
  "ruleId": "rule_abc123",
  "updatedBy": "JKira",
  "clientId": "pc-01"
}
```

## Notes

- Rules are disabled, not hard-deleted.
- `ruleId` is the unique key used for updates.
- This is built for the timeout script's shared saved selector/error rules, not live timeout events.
