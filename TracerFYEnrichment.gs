/**
 * TracerFY Enrichment - Google Apps Script (STANDALONE)
 * Second-stage enrichment. Run AFTER Serper. You decide which rows to run through TracerFY.
 * Typically: rows that have Address from Serper but need more phone/email.
 *
 * Uses Script Properties: TRACERFY_API_KEY, TRACERFY_ENDPOINT, TRACERFY_MODE, BATCH_SIZE, REQUEST_DELAY_MS, MAX_RETRIES
 */

// Uses same output columns as Serper: Address, Phone, Email, Website, Source_URL, Last_Checked
var TRACERFY_COLS = ['Address', 'Phone', 'Email', 'Website', 'Source_URL', 'Last_Checked'];

function tracerfyGetProps() {
  var p = PropertiesService.getScriptProperties();
  return {
    TRACERFY_API_KEY: p.getProperty('TRACERFY_API_KEY') || '',
    TRACERFY_ENDPOINT: p.getProperty('TRACERFY_ENDPOINT') || '',
    TRACERFY_MODE: (p.getProperty('TRACERFY_MODE') || 'DRY_RUN').toUpperCase(),
    BATCH_SIZE: parseInt(p.getProperty('BATCH_SIZE') || '25', 10),
    REQUEST_DELAY_MS: parseInt(p.getProperty('REQUEST_DELAY_MS') || '250', 10),
    MAX_RETRIES: parseInt(p.getProperty('MAX_RETRIES') || '5', 10)
  };
}

function tracerfySetKey() {
  var ui = SpreadsheetApp.getUi();
  var keyResp = ui.prompt('TracerFY API Key', 'Enter your TracerFY API key:', ui.ButtonSet.OK_CANCEL);
  if (keyResp.getSelectedButton() !== ui.Button.OK) return;
  var endpointResp = ui.prompt('TracerFY Endpoint', 'Enter TracerFY API endpoint URL:', ui.ButtonSet.OK_CANCEL);
  if (endpointResp.getSelectedButton() !== ui.Button.OK) return;
  var modeResp = ui.prompt('TRACERFY_MODE', 'Enter DRY_RUN or LIVE:', ui.ButtonSet.OK_CANCEL);
  if (modeResp.getSelectedButton() !== ui.Button.OK) return;

  var p = PropertiesService.getScriptProperties();
  p.setProperty('TRACERFY_API_KEY', keyResp.getResponseText() || '');
  p.setProperty('TRACERFY_ENDPOINT', endpointResp.getResponseText() || '');
  var mode = (modeResp.getResponseText() || 'DRY_RUN').toUpperCase();
  p.setProperty('TRACERFY_MODE', mode === 'LIVE' ? 'LIVE' : 'DRY_RUN');
  ui.alert('Settings saved.');
}

function tracerfyValidateKey() {
  var props = tracerfyGetProps();
  if (props.TRACERFY_MODE === 'DRY_RUN') {
    SpreadsheetApp.getUi().alert('TracerFY DRY_RUN enabled; no live validation performed.');
    return;
  }
  if (!props.TRACERFY_API_KEY || !props.TRACERFY_ENDPOINT) {
    SpreadsheetApp.getUi().alert('TRACERFY_API_KEY and TRACERFY_ENDPOINT must be set for LIVE mode.');
    return;
  }
  var result = tracerfyLookup({ name: 'Test', city: 'Test', state: 'TX' }, props);
  SpreadsheetApp.getUi().alert(result.ok ? 'TracerFY: OK' : 'TracerFY: FAIL - ' + (result.error || '').substring(0, 150));
}

function tracerfyFindCol(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase();
    for (var n = 0; n < names.length; n++) {
      if (h.indexOf(names[n]) !== -1) return i;
    }
  }
  return -1;
}

function tracerfyGetSheetConfig(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0].map(function(h) { return String(h || ''); });
  var nameCol = tracerfyFindCol(headers, ['name', 'full name']);
  var firstCol = tracerfyFindCol(headers, ['first name', 'firstname']);
  var lastCol = tracerfyFindCol(headers, ['last name', 'lastname']);
  var cityCol = tracerfyFindCol(headers, ['city']);
  var stateCol = tracerfyFindCol(headers, ['state']);
  var addrCol = tracerfyFindCol(headers, ['address']);
  var phoneCol = tracerfyFindCol(headers, ['phone']);
  var emailCol = tracerfyFindCol(headers, ['email']);
  var websiteCol = tracerfyFindCol(headers, ['website']);
  var sourceCol = tracerfyFindCol(headers, ['source_url', 'source url']);

  var nameColFinal = nameCol >= 0 ? nameCol : (firstCol >= 0 ? firstCol : -1);
  if (nameColFinal < 0 || cityCol < 0 || stateCol < 0) return null;

  var needCols = addrCol < 0 || phoneCol < 0 || emailCol < 0;
  if (needCols) {
    var outStart = headers.length;
    sheet.getRange(1, outStart + 1, 1, outStart + TRACERFY_COLS.length).setValues([TRACERFY_COLS]);
    sheet.getRange(1, outStart + 1, 1, outStart + TRACERFY_COLS.length).setFontWeight('bold');
    data = sheet.getDataRange().getValues();
    headers = data[0].map(function(h) { return String(h || ''); });
  }

  var baseOut = headers.length - TRACERFY_COLS.length;
  if (baseOut < 0) baseOut = 0;
  if (addrCol < 0) addrCol = baseOut;
  if (phoneCol < 0) phoneCol = baseOut + 1;
  if (emailCol < 0) emailCol = baseOut + 2;
  if (websiteCol < 0) websiteCol = baseOut + 3;
  if (sourceCol < 0) sourceCol = baseOut + 4;

  return {
    data: data,
    headers: headers,
    nameCol: nameColFinal,
    firstCol: firstCol,
    lastCol: lastCol,
    cityCol: cityCol,
    stateCol: stateCol,
    addrCol: addrCol,
    phoneCol: phoneCol,
    emailCol: emailCol,
    websiteCol: websiteCol,
    sourceCol: sourceCol
  };
}

function tracerfyGetRowName(cfg, row) {
  var name = '';
  if (cfg.nameCol >= 0) name = String(row[cfg.nameCol] || '').trim();
  if (!name && cfg.firstCol >= 0 && cfg.lastCol >= 0) {
    name = (String(row[cfg.firstCol] || '') + ' ' + String(row[cfg.lastCol] || '')).trim();
  }
  return name;
}

function tracerfyLookup(rowObj, props) {
  if (props.TRACERFY_MODE === 'DRY_RUN') {
    return { ok: true, dryRun: true, data: {} };
  }
  if (!props.TRACERFY_ENDPOINT || !props.TRACERFY_ENDPOINT.trim()) {
    return { ok: false, error: 'TracerFY endpoint not configured' };
  }

  var payload = {};
  if (rowObj.name) payload.name = rowObj.name;
  if (rowObj.firstName) payload.firstName = rowObj.firstName;
  if (rowObj.lastName) payload.lastName = rowObj.lastName;
  if (rowObj.city) payload.city = rowObj.city;
  if (rowObj.state) payload.state = rowObj.state;
  if (rowObj.address) payload.address = rowObj.address;
  if (rowObj.phone) payload.phone = rowObj.phone;
  if (rowObj.email) payload.email = rowObj.email;
  if (rowObj.website) payload.website = rowObj.website;

  var lastErr;
  for (var attempt = 0; attempt < props.MAX_RETRIES; attempt++) {
    try {
      var options = {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-API-KEY': props.TRACERFY_API_KEY, 'Authorization': 'Bearer ' + props.TRACERFY_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      var resp = UrlFetchApp.fetch(props.TRACERFY_ENDPOINT, options);
      var code = resp.getResponseCode();
      var body = resp.getContentText();

      if (code === 200) {
        var data = {};
        try { data = JSON.parse(body); } catch (e) {}
        return { ok: true, data: data };
      }
      if (code === 429 || (code >= 500 && code < 600)) {
        lastErr = body;
        Utilities.sleep(props.REQUEST_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, error: body };
    } catch (e) {
      lastErr = e;
      Utilities.sleep(props.REQUEST_DELAY_MS * Math.pow(2, attempt));
    }
  }
  return { ok: false, error: String(lastErr) };
}

function tracerfyMerge(existing, tracerData) {
  var d = tracerData || {};
  var out = {
    address: existing.address || d.address || '',
    phone: existing.phone || d.phone || '',
    email: existing.email || d.email || '',
    website: existing.website || d.website || '',
    source_url: existing.source_url || d.source_url || d.sourceUrl || ''
  };
  if (d.address && !out.address) out.address = d.address;
  if (d.phone && !out.phone) out.phone = d.phone;
  if (d.email && !out.email) out.email = d.email;
  if (d.website && !out.website) out.website = d.website;
  if ((d.source_url || d.sourceUrl) && !out.source_url) out.source_url = d.source_url || d.sourceUrl;
  return out;
}

function tracerfyEnrichSelected() {
  var props = tracerfyGetProps();
  if (props.TRACERFY_MODE === 'LIVE' && (!props.TRACERFY_API_KEY || !props.TRACERFY_ENDPOINT)) {
    SpreadsheetApp.getUi().alert('TRACERFY_API_KEY and TRACERFY_ENDPOINT required for LIVE mode. Use TracerFY → Settings.');
    return;
  }

  var selection = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getActiveRange();
  if (!selection) {
    SpreadsheetApp.getUi().alert('Select the rows to enrich first.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var cfg = tracerfyGetSheetConfig(sheet);
  if (!cfg) {
    SpreadsheetApp.getUi().alert('Could not find Name, City, State columns.');
    return;
  }

  var selFirst = Math.max(2, selection.getRow());
  var selLast = selection.getLastRow();
  var data = cfg.data;
  var toProcess = [];
  for (var r = selFirst; r <= selLast; r++) {
    toProcess.push({ rowIndex: r, data: data[r - 1] });
  }

  var batchSize = props.BATCH_SIZE;
  var limit = Math.min(toProcess.length, batchSize);
  var processed = 0;
  var startCol = cfg.addrCol + 1;

  for (var i = 0; i < limit; i++) {
    var item = toProcess[i];
    var r = item.rowIndex;
    var row = item.data;
    var name = tracerfyGetRowName(cfg, row);
    var city = cfg.cityCol >= 0 ? String(row[cfg.cityCol] || '').trim() : '';
    var state = cfg.stateCol >= 0 ? String(row[cfg.stateCol] || '').trim() : '';
    var addr = cfg.addrCol >= 0 ? String(row[cfg.addrCol] || '').trim() : '';
    var phone = cfg.phoneCol >= 0 ? String(row[cfg.phoneCol] || '').trim() : '';
    var email = cfg.emailCol >= 0 ? String(row[cfg.emailCol] || '').trim() : '';
    var website = cfg.websiteCol >= 0 ? String(row[cfg.websiteCol] || '').trim() : '';
    var sourceUrl = cfg.sourceCol >= 0 ? String(row[cfg.sourceCol] || '').trim() : '';

    var nameParts = name.split(/\s+/);
    var rowObj = {
      name: name,
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      city: city,
      state: state,
      address: addr,
      phone: phone,
      email: email,
      website: website
    };

    var result = tracerfyLookup(rowObj, props);

    var existing = { address: addr, phone: phone, email: email, website: website, source_url: sourceUrl };
    var merged = tracerfyMerge(existing, result.data);

    var vals = [
      merged.address,
      merged.phone,
      merged.email,
      merged.website,
      merged.source_url,
      new Date().toISOString()
    ];

    sheet.getRange(r, startCol, r, startCol + 5).setValues([vals]);
    if (result.ok) processed++;

    if (i < limit - 1) Utilities.sleep(props.REQUEST_DELAY_MS);
  }

  var msg = props.TRACERFY_MODE === 'DRY_RUN'
    ? 'TracerFY DRY_RUN: ' + limit + ' rows processed (no API calls).'
    : 'TracerFY: processed ' + processed + ' of ' + limit + ' rows.';
  SpreadsheetApp.getUi().alert(msg);
}
