const CONFIG = {
  spreadsheetId: '151rbB6RHol3o53Ic9p1a-6QwEivdC640ePWhK2AU824',
  sheetName: 'Sheet1',
  sharedKey: 'gwpc-timeout-rules-24apr2026-jkira-91x7p',
  maxRows: 5000
};

const HEADERS = [
  'ruleId',
  'enabled',
  'label',
  'savedErrorText',
  'selector',
  'fingerprintJson',
  'createdAt',
  'updatedAt',
  'sourceScript',
  'sourceVersion',
  'updatedBy',
  'clientId'
];

function doGet(e) {
  const request = buildRequest_(e, 'GET');
  if (!authorize_(request)) {
    return json_({ ok: false, error: 'Unauthorized' });
  }

  const action = normalize_(request.action || 'listRules');
  if (action === 'ping') {
    return json_({
      ok: true,
      action: 'ping',
      service: 'gwpc-timeout-shared-rules',
      now: nowIso_()
    });
  }

  if (action !== 'listRules') {
    return json_({ ok: false, error: `Unsupported GET action: ${action}` });
  }

  const includeDisabled = normalize_(request.includeDisabled || '') === 'true' || normalize_(request.includeDisabled || '') === '1';
  const sheet = ensureSheet_();
  const rows = readRows_(sheet);
  const rules = rows
    .filter((row) => includeDisabled || row.enabled === true)
    .map((row) => toRuleResponse_(row));

  return json_({
    ok: true,
    action: 'listRules',
    count: rules.length,
    rules,
    now: nowIso_()
  });
}

function doPost(e) {
  const request = buildRequest_(e, 'POST');
  if (!authorize_(request)) {
    return json_({ ok: false, error: 'Unauthorized' });
  }

  const action = normalize_(request.action || '');
  if (!action) {
    return json_({ ok: false, error: 'Missing action' });
  }

  const sheet = ensureSheet_();

  if (action === 'upsertRule') {
    const rule = normalizeRulePayload_(request.rule || request);
    if (!rule.ruleId) {
      return json_({ ok: false, error: 'Missing ruleId' });
    }
    if (!rule.savedErrorText) {
      return json_({ ok: false, error: 'Missing savedErrorText' });
    }
    if (!rule.selector) {
      return json_({ ok: false, error: 'Missing selector' });
    }

    const result = upsertRule_(sheet, rule);
    trimSheetIfNeeded_(sheet);
    return json_({
      ok: true,
      action: 'upsertRule',
      result,
      now: nowIso_()
    });
  }

  if (action === 'disableRule') {
    const ruleId = normalize_(request.ruleId || request.id || '');
    if (!ruleId) {
      return json_({ ok: false, error: 'Missing ruleId' });
    }

    const updatedBy = normalize_(request.updatedBy || 'timeout-script');
    const clientId = normalize_(request.clientId || '');
    const result = disableRule_(sheet, ruleId, updatedBy, clientId);
    trimSheetIfNeeded_(sheet);
    return json_({
      ok: true,
      action: 'disableRule',
      result,
      now: nowIso_()
    });
  }

  return json_({ ok: false, error: `Unsupported POST action: ${action}` });
}

function ensureSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.sheetName);
  }

  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  const currentHeaders = headerRange.getValues()[0].map((value) => normalize_(value));
  const expectedHeaders = HEADERS.map((value) => normalize_(value));
  const headersMatch = expectedHeaders.every((value, index) => currentHeaders[index] === value);

  if (!headersMatch) {
    headerRange.setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .map((row, index) => fromSheetRow_(row, index + 2))
    .filter((row) => row.ruleId);
}

function fromSheetRow_(row, rowNumber) {
  return {
    rowNumber,
    ruleId: normalize_(row[0]),
    enabled: toBoolean_(row[1], true),
    label: normalize_(row[2]),
    savedErrorText: normalize_(row[3]),
    selector: normalize_(row[4]),
    fingerprintJson: normalize_(row[5]),
    createdAt: normalize_(row[6]),
    updatedAt: normalize_(row[7]),
    sourceScript: normalize_(row[8]),
    sourceVersion: normalize_(row[9]),
    updatedBy: normalize_(row[10]),
    clientId: normalize_(row[11])
  };
}

function toRuleResponse_(row) {
  return {
    ruleId: row.ruleId,
    enabled: row.enabled === true,
    label: row.label,
    savedErrorText: row.savedErrorText,
    selector: row.selector,
    fingerprint: safeParseJson_(row.fingerprintJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sourceScript: row.sourceScript,
    sourceVersion: row.sourceVersion,
    updatedBy: row.updatedBy,
    clientId: row.clientId
  };
}

function upsertRule_(sheet, rule) {
  const rows = readRows_(sheet);
  const now = nowIso_();
  const existing = rows.find((row) => row.ruleId === rule.ruleId) || null;
  const rowValues = [[
    rule.ruleId,
    rule.enabled === false ? false : true,
    rule.label,
    rule.savedErrorText,
    rule.selector,
    JSON.stringify(rule.fingerprint || {}),
    existing ? existing.createdAt || now : (rule.createdAt || now),
    now,
    rule.sourceScript,
    rule.sourceVersion,
    rule.updatedBy,
    rule.clientId
  ]];

  if (existing) {
    sheet.getRange(existing.rowNumber, 1, 1, HEADERS.length).setValues(rowValues);
    return {
      mode: 'updated',
      rowNumber: existing.rowNumber,
      ruleId: rule.ruleId
    };
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues(rowValues);
  return {
    mode: 'inserted',
    rowNumber: sheet.getLastRow(),
    ruleId: rule.ruleId
  };
}

function disableRule_(sheet, ruleId, updatedBy, clientId) {
  const rows = readRows_(sheet);
  const existing = rows.find((row) => row.ruleId === ruleId) || null;
  const now = nowIso_();

  if (!existing) {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([[
      ruleId,
      false,
      '',
      '',
      '',
      JSON.stringify({}),
      now,
      now,
      'GWPC Header Timeout Monitor',
      '',
      updatedBy,
      clientId
    ]]);
    return {
      mode: 'inserted-disabled',
      rowNumber: sheet.getLastRow(),
      ruleId
    };
  }

  sheet.getRange(existing.rowNumber, 1, 1, HEADERS.length).setValues([[
    existing.ruleId,
    false,
    existing.label,
    existing.savedErrorText,
    existing.selector,
    existing.fingerprintJson || JSON.stringify({}),
    existing.createdAt || now,
    now,
    existing.sourceScript || 'GWPC Header Timeout Monitor',
    existing.sourceVersion || '',
    updatedBy,
    clientId
  ]]);

  return {
    mode: 'disabled',
    rowNumber: existing.rowNumber,
    ruleId
  };
}

function trimSheetIfNeeded_(sheet) {
  if (!CONFIG.maxRows || CONFIG.maxRows < 10) return;
  const rows = readRows_(sheet);
  if (rows.length <= CONFIG.maxRows) return;

  const removable = rows
    .slice()
    .sort((a, b) => {
      const aEnabled = a.enabled === true ? 1 : 0;
      const bEnabled = b.enabled === true ? 1 : 0;
      if (aEnabled !== bEnabled) return aEnabled - bEnabled;
      return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    });

  const removeCount = rows.length - CONFIG.maxRows;
  const rowNumbers = removable.slice(0, removeCount).map((row) => row.rowNumber).sort((a, b) => b - a);
  rowNumbers.forEach((rowNumber) => sheet.deleteRow(rowNumber));
}

function normalizeRulePayload_(raw) {
  const rule = raw && typeof raw === 'object' ? raw : {};
  return {
    ruleId: normalize_(rule.ruleId || rule.id || ''),
    enabled: rule.enabled === false ? false : true,
    label: normalize_(rule.label || rule.savedErrorText || ''),
    savedErrorText: normalize_(rule.savedErrorText || rule.errorText || rule.label || ''),
    selector: normalize_(rule.selector || ''),
    fingerprint: rule.fingerprint && typeof rule.fingerprint === 'object' ? rule.fingerprint : {},
    createdAt: normalize_(rule.createdAt || ''),
    sourceScript: normalize_(rule.sourceScript || 'GWPC Header Timeout Monitor'),
    sourceVersion: normalize_(rule.sourceVersion || ''),
    updatedBy: normalize_(rule.updatedBy || 'timeout-script'),
    clientId: normalize_(rule.clientId || '')
  };
}

function buildRequest_(e, method) {
  const params = e && e.parameter ? e.parameter : {};
  let body = {};

  if (method === 'POST' && e && e.postData && e.postData.contents) {
    body = safeParseJson_(e.postData.contents, {});
  }

  return {
    method,
    action: body.action || params.action || '',
    key: body.key || params.key || '',
    includeDisabled: body.includeDisabled || params.includeDisabled || '',
    rule: body.rule || {},
    ruleId: body.ruleId || params.ruleId || '',
    id: body.id || params.id || '',
    updatedBy: body.updatedBy || params.updatedBy || '',
    clientId: body.clientId || params.clientId || ''
  };
}

function authorize_(request) {
  return normalize_(request.key) && normalize_(request.key) === normalize_(CONFIG.sharedKey);
}

function safeParseJson_(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function normalize_(value) {
  return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function toBoolean_(value, fallback) {
  const text = String(value == null ? '' : value).toLowerCase().trim();
  if (!text) return !!fallback;
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return !!fallback;
}

function nowIso_() {
  return new Date().toISOString();
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
