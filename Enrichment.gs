/**
 * Enrichment - Google Apps Script
 * Two-stage enrichment: Serper → TracerFY
 * Uses Script Properties for all config. No hardcoded keys.
 */

const OUTPUT_HEADERS = ['Address', 'Phone', 'Email', 'Website', 'Source_URL', 'Confidence', 'Status', 'Last_Checked'];
const STATUS = {
  PENDING_SERPER: 'PENDING_SERPER',
  DONE_SERPER: 'DONE_SERPER',
  FAIL_SERPER: 'FAIL_SERPER',
  PENDING_TRACER: 'PENDING_TRACER',
  DONE_TRACER: 'DONE_TRACER',
  FAIL_TRACER: 'FAIL_TRACER'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Enrichment')
    .addItem('Serper → Enrich Selected Rows', 'serperEnrichSelected')
    .addItem('Serper → Enrich Pending Rows', 'serperEnrichPending')
    .addItem('TracerFY → Enrich Selected Rows', 'tracerfyEnrichSelected')
    .addItem('TracerFY → Enrich Pending Rows', 'tracerfyEnrichPending')
    .addSeparator()
    .addItem('Settings → Set/Update API Keys', 'settingsSetKeys')
    .addItem('Settings → Validate Keys', 'settingsValidateKeys')
    .addSeparator()
    .addItem('Utilities → Reset Status for Selected', 'utilsResetSelected')
    .addItem('Utilities → Reset Status for All Rows', 'utilsResetAll')
    .addToUi();
}

function getProps() {
  const p = PropertiesService.getScriptProperties();
  return {
    SERPER_API_KEY: p.getProperty('SERPER_API_KEY') || '',
    SERPER_ENDPOINT: p.getProperty('SERPER_ENDPOINT') || 'https://google.serper.dev/search',
    TRACERFY_API_KEY: p.getProperty('TRACERFY_API_KEY') || '',
    TRACERFY_ENDPOINT: p.getProperty('TRACERFY_ENDPOINT') || '',
    TRACERFY_MODE: p.getProperty('TRACERFY_MODE') || 'DRY_RUN',
    BATCH_SIZE: parseInt(p.getProperty('BATCH_SIZE') || '25', 10),
    CONFIDENCE_THRESHOLD: parseInt(p.getProperty('CONFIDENCE_THRESHOLD') || '60', 10),
    REQUEST_DELAY_MS: parseInt(p.getProperty('REQUEST_DELAY_MS') || '250', 10),
    MAX_RETRIES: parseInt(p.getProperty('MAX_RETRIES') || '5', 10)
  };
}

function setProps(props) {
  const p = PropertiesService.getScriptProperties();
  Object.keys(props).forEach(function(k) {
    if (props[k] !== undefined && props[k] !== null) p.setProperty(k, String(props[k]));
  });
}

function ensureLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName('Enrichment_Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Enrichment_Log');
    logSheet.getRange(1, 1, 1, 7).setValues([['timestamp', 'sheet', 'row', 'stage', 'status', 'message', 'snippet']]);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return logSheet;
}

function logEnrichment(sheetName, rowNum, stage, status, message, snippet) {
  const logSheet = ensureLogSheet();
  const snippetSafe = (snippet || '').substring(0, 500);
  logSheet.appendRow([
    new Date().toISOString(),
    sheetName,
    rowNum,
    stage,
    status,
    (message || '').substring(0, 1000),
    snippetSafe
  ]);
}

function findCol(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase();
    for (var n = 0; n < names.length; n++) {
      if (h.indexOf(names[n]) !== -1) return i;
    }
  }
  return -1;
}

function getSheetConfig(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0].map(function(h) { return String(h || ''); });
  var nameCol = findCol(headers, ['name', 'full name']);
  var firstCol = findCol(headers, ['first name', 'firstname']);
  var lastCol = findCol(headers, ['last name', 'lastname']);
  var cityCol = findCol(headers, ['city']);
  var stateCol = findCol(headers, ['state']);

  var nameColFinal = nameCol >= 0 ? nameCol : (firstCol >= 0 ? firstCol : -1);
  if (nameColFinal < 0 || cityCol < 0 || stateCol < 0) return null;

  var outColStart = headers.length;
  var needHeaders = false;
  for (var i = 0; i < OUTPUT_HEADERS.length; i++) {
    var idx = findCol(headers, [OUTPUT_HEADERS[i].toLowerCase().replace(/_/g, ' ')]);
    if (idx < 0) idx = findCol(headers, [OUTPUT_HEADERS[i].toLowerCase()]);
    if (idx < 0) { needHeaders = true; break; }
  }
  if (needHeaders) {
    sheet.getRange(1, outColStart + 1, 1, outColStart + OUTPUT_HEADERS.length).setValues([OUTPUT_HEADERS]);
    sheet.getRange(1, outColStart + 1, 1, outColStart + OUTPUT_HEADERS.length).setFontWeight('bold');
    data = sheet.getDataRange().getValues();
    headers = data[0].map(function(h) { return String(h || ''); });
  }

  var addrCol = findCol(headers, ['address']);
  var phoneCol = findCol(headers, ['phone']);
  var emailCol = findCol(headers, ['email']);
  var websiteCol = findCol(headers, ['website']);
  var sourceCol = findCol(headers, ['source_url', 'source url']);
  var confCol = findCol(headers, ['confidence']);
  var statusCol = findCol(headers, ['status']);
  var lastColIdx = findCol(headers, ['last_checked', 'last checked']);

  if (statusCol < 0) {
    statusCol = headers.length;
    sheet.getRange(1, statusCol + 1).setValue('Status');
    sheet.getRange(1, statusCol + 1).setFontWeight('bold');
    data = sheet.getDataRange().getValues();
    for (var r = 2; r <= data.length; r++) {
      var nm = (nameColFinal >= 0 ? String(data[r - 1][nameColFinal] || '') : '') +
        (firstCol >= 0 && lastCol >= 0 ? ' ' + String(data[r - 1][firstCol] || '') + ' ' + String(data[r - 1][lastCol] || '') : '');
      var ct = cityCol >= 0 ? String(data[r - 1][cityCol] || '') : '';
      var st = stateCol >= 0 ? String(data[r - 1][stateCol] || '') : '';
      if ((nm + ct + st).trim()) {
        sheet.getRange(r, statusCol + 1).setValue(STATUS.PENDING_SERPER);
      }
    }
    data = sheet.getDataRange().getValues();
  }

  var baseOut = headers.length - OUTPUT_HEADERS.length;
  if (baseOut < 0) baseOut = 0;
  if (addrCol < 0) addrCol = baseOut;
  if (phoneCol < 0) phoneCol = baseOut + 1;
  if (emailCol < 0) emailCol = baseOut + 2;
  if (websiteCol < 0) websiteCol = baseOut + 3;
  if (sourceCol < 0) sourceCol = baseOut + 4;
  if (confCol < 0) confCol = baseOut + 5;
  if (statusCol < 0) statusCol = baseOut + 6;
  if (lastColIdx < 0) lastColIdx = baseOut + 7;

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
    sourceCol: sourceCol,
    confCol: confCol,
    statusCol: statusCol,
    lastColIdx: lastColIdx,
    outCols: [addrCol, phoneCol, emailCol, websiteCol, sourceCol, confCol, statusCol, lastColIdx]
  };
}

function getRowName(cfg, row) {
  var name = '';
  if (cfg.nameCol >= 0) name = String(row[cfg.nameCol] || '').trim();
  if (!name && cfg.firstCol >= 0 && cfg.lastCol >= 0) {
    name = (String(row[cfg.firstCol] || '') + ' ' + String(row[cfg.lastCol] || '')).trim();
  }
  return name;
}

function getRowsToProcess(rows, cfg, selectedOnly, statusFilter) {
  var out = [];
  var sel = selectedOnly ? null : null;
  if (selectedOnly) {
    var selection = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getActiveRange();
    if (!selection) return out;
    var selFirst = selection.getRow();
    var selLast = selection.getLastRow();
    if (selFirst === 1) selFirst = 2;
    for (var r = selFirst; r <= selLast; r++) {
      var st = (rows[r - 1][cfg.statusCol] || '').toString();
      if (statusFilter(st)) out.push({ rowIndex: r, data: rows[r - 1] });
    }
  } else {
    for (var r = 2; r <= rows.length; r++) {
      var st = (rows[r - 1][cfg.statusCol] || '').toString();
      if (statusFilter(st)) out.push({ rowIndex: r, data: rows[r - 1] });
    }
  }
  return out;
}

function extractPhones(text) {
  var re = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:\d{3}[-.\s]){2}\d{4}/g;
  var m = (text || '').match(re) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    if (!seen[m[i]]) { seen[m[i]] = true; out.push(m[i]); }
  }
  return out;
}

function extractEmails(text) {
  var re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  var m = (text || '').match(re) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    if (!seen[m[i]]) { seen[m[i]] = true; out.push(m[i]); }
  }
  return out;
}

function extractAddresses(text) {
  var found = [];
  var fullRe = /\d+\s+[A-Za-z0-9\s.\-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir)[,.\s]+[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi;
  var m;
  while ((m = fullRe.exec(text)) !== null) found.push(m[0].trim());
  var streetRe = /(\d+\s+[A-Za-z0-9\s.\-]+(?:St|Ave|Rd|Blvd|Dr|Ln|Ct)\.?)\s*[,]?\s*([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/gi;
  while ((m = streetRe.exec(text)) !== null) {
    var addr = m[1].trim() + ', ' + m[2].trim() + ', ' + m[3] + ' ' + m[4];
    if (found.indexOf(addr) === -1) found.push(addr);
  }
  var seen = {};
  var out = [];
  for (var i = 0; i < found.length; i++) {
    if (!seen[found[i]]) { seen[found[i]] = true; out.push(found[i]); }
  }
  return out;
}

function extractZip(text) {
  var m = (text || '').match(/[A-Za-z\s]+,\s*[A-Z]{2}\s+(\d{5}(?:-\d{4})?)/i);
  return m ? m[1] : null;
}

function extractUrls(text) {
  var re = /https?:\/\/[^\s"'<>]+/gi;
  var m = (text || '').match(re) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    var u = m[i].replace(/[.,;:!?)]+$/, '');
    if (!seen[u] && u.length < 200) { seen[u] = true; out.push(u); }
  }
  return out;
}

function collectSerperText(data) {
  var parts = [];
  var kg = data.knowledgeGraph || {};
  if (kg.description) parts.push(kg.description);
  if (kg.attributes) {
    for (var k in kg.attributes) {
      if (kg.attributes.hasOwnProperty(k)) parts.push(String(kg.attributes[k]));
    }
  }
  var organic = data.organic || [];
  for (var i = 0; i < organic.length; i++) {
    if (organic[i].snippet) parts.push(organic[i].snippet);
    if (organic[i].title) parts.push(organic[i].title);
    if (organic[i].link) parts.push(organic[i].link);
  }
  var paa = data.peopleAlsoAsk || [];
  for (var j = 0; j < paa.length; j++) {
    if (paa[j].snippet) parts.push(paa[j].snippet);
  }
  var places = data.places || [];
  for (var p = 0; p < places.length; p++) {
    if (places[p].name) parts.push(places[p].name);
    if (places[p].address) parts.push(places[p].address);
    if (places[p].snippet) parts.push(places[p].snippet);
  }
  return parts.join(' ');
}

function scoreSerper(data, queryTokens, city, state) {
  var text = collectSerperText(data);
  var phones = extractPhones(text);
  var emails = extractEmails(text);
  var addresses = extractAddresses(text);
  var urls = extractUrls(text);

  var score = 0;
  var cityLower = (city || '').toLowerCase();
  var stateLower = (state || '').toLowerCase();
  var textLower = text.toLowerCase();
  if (cityLower && textLower.indexOf(cityLower) >= 0) score += 20;
  if (stateLower && textLower.indexOf(stateLower) >= 0) score += 15;
  if (addresses.length > 0) score += 25;
  if (phones.length > 0) score += 20;
  if (emails.length > 0) score += 20;
  if (urls.length > 0) score += 5;

  return {
    score: Math.min(100, score),
    addresses: addresses,
    phones: phones,
    emails: emails,
    urls: urls,
    text: text
  };
}

function serperFetch(url, apiKey, payload, props) {
  var lastErr;
  for (var attempt = 0; attempt < props.MAX_RETRIES; attempt++) {
    try {
      var options = {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-API-KEY': apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      var resp = UrlFetchApp.fetch(url, options);
      var code = resp.getResponseCode();
      var body = resp.getContentText();

      if (code === 200) return { ok: true, data: JSON.parse(body) };
      if (code === 429 || (code >= 500 && code < 600)) {
        lastErr = { code: code, body: body };
        var delay = props.REQUEST_DELAY_MS * Math.pow(2, attempt);
        Utilities.sleep(delay);
        continue;
      }
      return { ok: false, code: code, body: body };
    } catch (e) {
      lastErr = e;
      var delay = props.REQUEST_DELAY_MS * Math.pow(2, attempt);
      Utilities.sleep(delay);
    }
  }
  return { ok: false, code: 0, body: lastErr ? String(lastErr) : 'Max retries' };
}

function serperLookup(name, city, state, props) {
  var parts = [name, city, state].filter(function(p) { return (p || '').trim(); });
  var query = parts.join(', ') + ' address phone email';
  var payload = { q: query, num: 10 };
  var result = serperFetch(props.SERPER_ENDPOINT, props.SERPER_API_KEY, payload, props);

  if (!result.ok) {
    return { ok: false, error: result.body, status: STATUS.FAIL_SERPER };
  }

  var data = result.data;
  var cityStr = (city || '').trim();
  var stateStr = (state || '').trim();
  var scored = scoreSerper(data, query.split(/\s+/), cityStr, stateStr);

  var addr = scored.addresses[0] || '';
  var phone = scored.phones[0] || '';
  var email = scored.emails[0] || '';
  var website = scored.urls[0] || '';
  var sourceUrl = '';
  var organic = data.organic || [];
  if (organic[0] && organic[0].link) sourceUrl = organic[0].link;

  return {
    ok: true,
    status: STATUS.DONE_SERPER,
    address: addr,
    phone: phone,
    email: email,
    website: website,
    source_url: sourceUrl,
    confidence: scored.score,
    pendingTracer: scored.score >= props.CONFIDENCE_THRESHOLD
  };
}

function tracerfyLookup_(rowObj, props) {
  if (props.TRACERFY_MODE === 'DRY_RUN') {
    return { ok: true, dryRun: true, data: {} };
  }
  if (!props.TRACERFY_ENDPOINT || !props.TRACERFY_ENDPOINT.trim()) {
    return { ok: false, error: 'TracerFY endpoint not configured', status: STATUS.FAIL_TRACER };
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
      return { ok: false, error: body, status: STATUS.FAIL_TRACER };
    } catch (e) {
      lastErr = e;
      Utilities.sleep(props.REQUEST_DELAY_MS * Math.pow(2, attempt));
    }
  }
  return { ok: false, error: String(lastErr), status: STATUS.FAIL_TRACER };
}

function mergeTracerData(existing, tracerData, currentConf) {
  var out = {};
  ['address', 'phone', 'email', 'website', 'source_url'].forEach(function(k) {
    out[k] = existing[k] || '';
  });
  out.confidence = currentConf || 0;

  var d = tracerData || {};
  var tracerConf = d.confidence != null ? parseInt(d.confidence, 10) : 0;

  if (d.address && (!out.address || tracerConf > out.confidence)) out.address = d.address;
  if (d.phone && (!out.phone || tracerConf > out.confidence)) out.phone = d.phone;
  if (d.email && (!out.email || tracerConf > out.confidence)) out.email = d.email;
  if (d.website && (!out.website || tracerConf > out.confidence)) out.website = d.website;
  if (d.source_url && (!out.source_url || tracerConf > out.confidence)) out.source_url = d.source_url;
  if (d.sourceUrl && (!out.source_url || tracerConf > out.confidence)) out.source_url = d.sourceUrl;
  if (tracerConf > out.confidence) out.confidence = tracerConf;

  return out;
}

function runSerperEnrichment(selectedOnly) {
  var props = getProps();
  if (!props.SERPER_API_KEY) {
    SpreadsheetApp.getUi().alert('SERPER_API_KEY not set. Use Settings → Set/Update API Keys.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var cfg = getSheetConfig(sheet);
  if (!cfg) {
    SpreadsheetApp.getUi().alert('Could not find Name (or First Name + Last Name), City, State columns.');
    return;
  }

  var rows = cfg.data;
  var toProcess = getRowsToProcess(rows, cfg, selectedOnly, function(st) {
    return st === STATUS.PENDING_SERPER || st === '' || st === 'PENDING_SERPER';
  });

  if (toProcess.length === 0) {
    SpreadsheetApp.getUi().alert('No rows to process (Status must be PENDING_SERPER).');
    return;
  }

  var batchSize = props.BATCH_SIZE;
  var processed = 0;
  var updates = [];

  for (var i = 0; i < Math.min(toProcess.length, batchSize); i++) {
    var item = toProcess[i];
    var r = item.rowIndex;
    var row = item.data;
    var name = getRowName(cfg, row);
    var city = cfg.cityCol >= 0 ? String(row[cfg.cityCol] || '').trim() : '';
    var state = cfg.stateCol >= 0 ? String(row[cfg.stateCol] || '').trim() : '';

    var result = serperLookup(name, city, state, props);

    if (result.ok) {
      var newStatus = result.pendingTracer ? STATUS.PENDING_TRACER : STATUS.FAIL_SERPER;
      if (!result.pendingTracer) {
        logEnrichment(sheet.getName(), r, 'SERPER', STATUS.FAIL_SERPER, 'Confidence ' + result.confidence + ' below threshold ' + props.CONFIDENCE_THRESHOLD, '');
      }
      updates.push({
        row: r,
        vals: [
          result.address,
          result.phone,
          result.email,
          result.website,
          result.source_url,
          result.confidence,
          newStatus,
          new Date().toISOString()
        ]
      });
      processed++;
      logEnrichment(sheet.getName(), r, 'SERPER', STATUS.DONE_SERPER, 'OK', JSON.stringify(result).substring(0, 300));
    } else {
      updates.push({
        row: r,
        vals: ['', '', '', '', '', 0, STATUS.FAIL_SERPER, new Date().toISOString()]
      });
      logEnrichment(sheet.getName(), r, 'SERPER', STATUS.FAIL_SERPER, result.error || result.body, (result.body || '').substring(0, 300));
    }

    if (i < toProcess.length - 1) Utilities.sleep(props.REQUEST_DELAY_MS);
  }

  if (updates.length > 0) {
    var numCols = 8;
    var startCol = cfg.addrCol + 1;
    for (var u = 0; u < updates.length; u++) {
      var uv = updates[u];
      sheet.getRange(uv.row, startCol, uv.row, startCol + numCols - 1).setValues([uv.vals]);
    }
  }

  SpreadsheetApp.getUi().alert('Serper: processed ' + processed + ' of ' + updates.length + ' rows.');
}

function runTracerfyEnrichment(selectedOnly) {
  var props = getProps();
  if (!props.TRACERFY_API_KEY && props.TRACERFY_MODE === 'LIVE') {
    SpreadsheetApp.getUi().alert('TRACERFY_API_KEY not set. Use Settings → Set/Update API Keys.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var cfg = getSheetConfig(sheet);
  if (!cfg) {
    SpreadsheetApp.getUi().alert('Could not find required columns.');
    return;
  }

  var rows = cfg.data;
  var toProcess = getRowsToProcess(rows, cfg, selectedOnly, function(st) {
    return st === STATUS.PENDING_TRACER || st === 'PENDING_TRACER';
  });

  if (toProcess.length === 0) {
    SpreadsheetApp.getUi().alert('No rows to process (Status must be PENDING_TRACER).');
    return;
  }

  var batchSize = props.BATCH_SIZE;
  var processed = 0;
  var updates = [];

  for (var i = 0; i < Math.min(toProcess.length, batchSize); i++) {
    var item = toProcess[i];
    var r = item.rowIndex;
    var row = item.data;
    var name = getRowName(cfg, row);
    var city = cfg.cityCol >= 0 ? String(row[cfg.cityCol] || '').trim() : '';
    var state = cfg.stateCol >= 0 ? String(row[cfg.stateCol] || '').trim() : '';
    var addr = cfg.addrCol >= 0 ? String(row[cfg.addrCol] || '').trim() : '';
    var phone = cfg.phoneCol >= 0 ? String(row[cfg.phoneCol] || '').trim() : '';
    var email = cfg.emailCol >= 0 ? String(row[cfg.emailCol] || '').trim() : '';
    var website = cfg.websiteCol >= 0 ? String(row[cfg.websiteCol] || '').trim() : '';
    var conf = cfg.confCol >= 0 ? parseInt(row[cfg.confCol], 10) || 0 : 0;

    var nameParts = name.split(/\s+/);
    var firstName = nameParts[0] || '';
    var lastName = nameParts.slice(1).join(' ') || '';

    var rowObj = {
      name: name,
      firstName: firstName,
      lastName: lastName,
      city: city,
      state: state,
      address: addr,
      phone: phone,
      email: email,
      website: website
    };

    var result = tracerfyLookup_(rowObj, props);

    if (result.dryRun) {
      logEnrichment(sheet.getName(), r, 'TRACERFY', 'DRY_RUN', 'DRY_RUN', JSON.stringify(rowObj).substring(0, 200));
      updates.push({
        row: r,
        vals: [addr, phone, email, website, row[cfg.sourceCol] || '', conf, STATUS.DONE_TRACER, new Date().toISOString()]
      });
      processed++;
    } else if (result.ok) {
      var merged = mergeTracerData(
        { address: addr, phone: phone, email: email, website: website, source_url: row[cfg.sourceCol] || '' },
        result.data,
        conf
      );
      updates.push({
        row: r,
        vals: [
          merged.address,
          merged.phone,
          merged.email,
          merged.website,
          merged.source_url,
          merged.confidence,
          STATUS.DONE_TRACER,
          new Date().toISOString()
        ]
      });
      processed++;
      logEnrichment(sheet.getName(), r, 'TRACERFY', STATUS.DONE_TRACER, 'OK', JSON.stringify(result.data).substring(0, 300));
    } else {
      updates.push({
        row: r,
        vals: [addr, phone, email, website, row[cfg.sourceCol] || '', conf, STATUS.FAIL_TRACER, new Date().toISOString()]
      });
      logEnrichment(sheet.getName(), r, 'TRACERFY', STATUS.FAIL_TRACER, result.error || '', (result.error || '').substring(0, 300));
    }

    if (i < toProcess.length - 1) Utilities.sleep(props.REQUEST_DELAY_MS);
  }

  if (updates.length > 0) {
    var numCols = 8;
    var startCol = cfg.addrCol + 1;
    for (var u = 0; u < updates.length; u++) {
      var uv = updates[u];
      sheet.getRange(uv.row, startCol, uv.row, startCol + numCols - 1).setValues([uv.vals]);
    }
  }

  SpreadsheetApp.getUi().alert('TracerFY: processed ' + processed + ' of ' + updates.length + ' rows.');
}

function serperEnrichSelected() { runSerperEnrichment(true); }
function serperEnrichPending() { runSerperEnrichment(false); }
function tracerfyEnrichSelected() { runTracerfyEnrichment(true); }
function tracerfyEnrichPending() { runTracerfyEnrichment(false); }

function utilsResetSelected() {
  var selection = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getActiveRange();
  if (!selection) {
    SpreadsheetApp.getUi().alert('Select the rows to reset first.');
    return;
  }
  var sheet = SpreadsheetApp.getActiveSheet();
  var cfg = getSheetConfig(sheet);
  if (!cfg) return;
  var firstRow = Math.max(2, selection.getRow());
  var lastRow = selection.getLastRow();
  var startCol = cfg.addrCol + 1;
  var resetVals = ['', '', '', '', '', '', STATUS.PENDING_SERPER, ''];
  for (var r = firstRow; r <= lastRow; r++) {
    sheet.getRange(r, startCol, r, startCol + 7).setValues([resetVals]);
  }
  SpreadsheetApp.getUi().alert('Reset ' + (lastRow - firstRow + 1) + ' rows to PENDING_SERPER.');
}

function utilsResetAll() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var cfg = getSheetConfig(sheet);
  if (!cfg) return;
  var lastRow = cfg.data.length;
  var startCol = cfg.addrCol + 1;
  var resetVals = ['', '', '', '', '', '', STATUS.PENDING_SERPER, ''];
  for (var r = 2; r <= lastRow; r++) {
    sheet.getRange(r, startCol, r, startCol + 7).setValues([resetVals]);
  }
  SpreadsheetApp.getUi().alert('Reset all rows to PENDING_SERPER.');
}

function settingsSetKeys() {
  var props = getProps();
  var ui = SpreadsheetApp.getUi();

  var serperKey = ui.prompt('SERPER_API_KEY', 'Enter your Serper API key:', ui.ButtonSet.OK_CANCEL);
  if (serperKey.getSelectedButton() !== ui.Button.OK) return;
  var serperEndpoint = ui.prompt('SERPER_ENDPOINT', 'Serper endpoint (default: https://google.serper.dev/search):', ui.ButtonSet.OK_CANCEL);
  if (serperEndpoint.getSelectedButton() !== ui.Button.OK) return;

  var tracerKey = ui.prompt('TRACERFY_API_KEY', 'Enter your TracerFY API key (optional):', ui.ButtonSet.OK_CANCEL);
  if (tracerKey.getSelectedButton() !== ui.Button.OK) return;
  var tracerEndpoint = ui.prompt('TRACERFY_ENDPOINT', 'TracerFY endpoint URL (optional):', ui.ButtonSet.OK_CANCEL);
  if (tracerEndpoint.getSelectedButton() !== ui.Button.OK) return;
  var tracerModeResp = ui.prompt('TRACERFY_MODE', 'Enter DRY_RUN or LIVE (default DRY_RUN):', ui.ButtonSet.OK_CANCEL);
  if (tracerModeResp.getSelectedButton() !== ui.Button.OK) return;
  var mode = (tracerModeResp.getResponseText() || 'DRY_RUN').toUpperCase();
  if (mode !== 'LIVE') mode = 'DRY_RUN';

  var batchSize = ui.prompt('BATCH_SIZE', 'Batch size (default 25):', ui.ButtonSet.OK_CANCEL);
  if (batchSize.getSelectedButton() !== ui.Button.OK) return;
  var confThresh = ui.prompt('CONFIDENCE_THRESHOLD', 'Confidence threshold 0-100 (default 60):', ui.ButtonSet.OK_CANCEL);
  if (confThresh.getSelectedButton() !== ui.Button.OK) return;

  setProps({
    SERPER_API_KEY: serperKey.getResponseText() || props.SERPER_API_KEY,
    SERPER_ENDPOINT: serperEndpoint.getResponseText() || props.SERPER_ENDPOINT,
    TRACERFY_API_KEY: tracerKey.getResponseText() || props.TRACERFY_API_KEY,
    TRACERFY_ENDPOINT: tracerEndpoint.getResponseText() || props.TRACERFY_ENDPOINT,
    TRACERFY_MODE: mode || props.TRACERFY_MODE,
    BATCH_SIZE: batchSize.getResponseText() || props.BATCH_SIZE,
    CONFIDENCE_THRESHOLD: confThresh.getResponseText() || props.CONFIDENCE_THRESHOLD
  });
  ui.alert('Settings saved.');
}

function settingsValidateKeys() {
  var props = getProps();
  var ui = SpreadsheetApp.getUi();
  ensureLogSheet();

  if (!props.SERPER_API_KEY) {
    ui.alert('SERPER_API_KEY not set.');
    return;
  }
  var serperResult = serperFetch(props.SERPER_ENDPOINT, props.SERPER_API_KEY, { q: 'test', num: 1 }, props);
  if (serperResult.ok) {
    logEnrichment('_validate', 0, 'SERPER', 'OK', 'Serper key valid', '');
    ui.alert('Serper: OK');
  } else {
    logEnrichment('_validate', 0, 'SERPER', 'FAIL', serperResult.body || '', '');
    ui.alert('Serper: FAIL - ' + (serperResult.body || '').substring(0, 200));
  }

  if (props.TRACERFY_MODE === 'DRY_RUN') {
    ui.alert('TracerFY DRY_RUN enabled; no live validation performed.');
    logEnrichment('_validate', 0, 'TRACERFY', 'DRY_RUN', 'No validation', '');
    return;
  }
  if (!props.TRACERFY_ENDPOINT || !props.TRACERFY_ENDPOINT.trim()) {
    ui.alert('TracerFY endpoint not configured.');
    return;
  }
  var tracerResult = tracerfyLookup_({ name: 'Test', city: 'Test', state: 'TX' }, props);
  if (tracerResult.ok) {
    logEnrichment('_validate', 0, 'TRACERFY', 'OK', 'TracerFY key valid', '');
    ui.alert('TracerFY: OK');
  } else {
    logEnrichment('_validate', 0, 'TRACERFY', 'FAIL', tracerResult.error || '', '');
    ui.alert('TracerFY: FAIL - ' + (tracerResult.error || '').substring(0, 200));
  }
}
