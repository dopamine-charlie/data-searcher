/**
 * Serper Enrichment - Google Apps Script (STANDALONE)
 * Enriches Name, City, State with Address, Phone, Email from Serper search.
 * End goal: get phone numbers and emails. Run this first. Review results. Then optionally run TracerFY on selected rows.
 *
 * Uses Script Properties: SERPER_API_KEY, SERPER_ENDPOINT, BATCH_SIZE, REQUEST_DELAY_MS, MAX_RETRIES
 */

var SERPER_OUTPUT_HEADERS = ['Address', 'Phone', 'Email', 'Website', 'Source_URL', 'Last_Checked'];

function serperGetProps() {
  var p = PropertiesService.getScriptProperties();
  return {
    SERPER_API_KEY: p.getProperty('SERPER_API_KEY') || '',
    SERPER_ENDPOINT: p.getProperty('SERPER_ENDPOINT') || 'https://google.serper.dev/search',
    BATCH_SIZE: parseInt(p.getProperty('BATCH_SIZE') || '25', 10),
    REQUEST_DELAY_MS: parseInt(p.getProperty('REQUEST_DELAY_MS') || '250', 10),
    MAX_RETRIES: parseInt(p.getProperty('MAX_RETRIES') || '5', 10)
  };
}

function serperSetKey() {
  var ui = SpreadsheetApp.getUi();
  var keyResp = ui.prompt('Serper API Key', 'Enter your Serper API key (from serper.dev):', ui.ButtonSet.OK_CANCEL);
  if (keyResp.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('SERPER_API_KEY', keyResp.getResponseText() || '');
  ui.alert('API key saved.');
}

function serperValidateKey() {
  var props = serperGetProps();
  if (!props.SERPER_API_KEY) {
    SpreadsheetApp.getUi().alert('SERPER_API_KEY not set.');
    return;
  }
  var result = serperFetch(props.SERPER_ENDPOINT, props.SERPER_API_KEY, { q: 'test', num: 1 }, props);
  SpreadsheetApp.getUi().alert(result.ok ? 'Serper: OK' : 'Serper: FAIL - ' + (result.body || '').substring(0, 150));
}

function serperFindCol(headers, names) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase();
    for (var n = 0; n < names.length; n++) {
      if (h.indexOf(names[n]) !== -1) return i;
    }
  }
  return -1;
}

function serperGetSheetConfig(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0].map(function(h) { return String(h || ''); });
  var nameCol = serperFindCol(headers, ['name', 'full name']);
  var firstCol = serperFindCol(headers, ['first name', 'firstname']);
  var lastCol = serperFindCol(headers, ['last name', 'lastname']);
  var cityCol = serperFindCol(headers, ['city']);
  var stateCol = serperFindCol(headers, ['state']);

  var nameColFinal = nameCol >= 0 ? nameCol : (firstCol >= 0 ? firstCol : -1);
  if (nameColFinal < 0 || cityCol < 0 || stateCol < 0) return null;

  var needHeaders = false;
  for (var i = 0; i < SERPER_OUTPUT_HEADERS.length; i++) {
    var idx = serperFindCol(headers, [SERPER_OUTPUT_HEADERS[i].toLowerCase().replace(/_/g, ' ')]);
    if (idx < 0) idx = serperFindCol(headers, [SERPER_OUTPUT_HEADERS[i].toLowerCase()]);
    if (idx < 0) { needHeaders = true; break; }
  }
  if (needHeaders) {
    var outColStart = headers.length;
    sheet.getRange(1, outColStart + 1, 1, outColStart + SERPER_OUTPUT_HEADERS.length).setValues([SERPER_OUTPUT_HEADERS]);
    sheet.getRange(1, outColStart + 1, 1, outColStart + SERPER_OUTPUT_HEADERS.length).setFontWeight('bold');
    data = sheet.getDataRange().getValues();
    headers = data[0].map(function(h) { return String(h || ''); });
  }

  var baseOut = headers.length - SERPER_OUTPUT_HEADERS.length;
  if (baseOut < 0) baseOut = 0;
  var addrCol = serperFindCol(headers, ['address']);
  var phoneCol = serperFindCol(headers, ['phone']);
  var emailCol = serperFindCol(headers, ['email']);
  if (addrCol < 0) addrCol = baseOut;
  if (phoneCol < 0) phoneCol = baseOut + 1;
  if (emailCol < 0) emailCol = baseOut + 2;

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
    emailCol: emailCol
  };
}

function serperGetRowName(cfg, row) {
  var name = '';
  if (cfg.nameCol >= 0) name = String(row[cfg.nameCol] || '').trim();
  if (!name && cfg.firstCol >= 0 && cfg.lastCol >= 0) {
    name = (String(row[cfg.firstCol] || '') + ' ' + String(row[cfg.lastCol] || '')).trim();
  }
  return name;
}

function serperExtractPhones(text) {
  var re = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:\d{3}[-.\s]){2}\d{4}/g;
  var m = (text || '').match(re) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    if (!seen[m[i]]) { seen[m[i]] = true; out.push(m[i]); }
  }
  return out;
}

function serperExtractEmails(text) {
  var re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  var m = (text || '').match(re) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < m.length; i++) {
    if (!seen[m[i]]) { seen[m[i]] = true; out.push(m[i]); }
  }
  return out;
}

function serperExtractAddresses(text) {
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

function serperExtractUrls(text) {
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

function serperCollectText(data) {
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
        lastErr = body;
        Utilities.sleep(props.REQUEST_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, body: body };
    } catch (e) {
      lastErr = e;
      Utilities.sleep(props.REQUEST_DELAY_MS * Math.pow(2, attempt));
    }
  }
  return { ok: false, body: lastErr ? String(lastErr) : 'Max retries' };
}

function serperLookup(name, city, state, props) {
  var parts = [name, city, state].filter(function(p) { return (p || '').trim(); });
  var query = parts.join(', ') + ' address phone email';
  var result = serperFetch(props.SERPER_ENDPOINT, props.SERPER_API_KEY, { q: query, num: 10 }, props);

  if (!result.ok) return { ok: false, error: result.body };

  var data = result.data;
  var text = serperCollectText(data);
  var phones = serperExtractPhones(text);
  var emails = serperExtractEmails(text);
  var addresses = serperExtractAddresses(text);
  var urls = serperExtractUrls(text);
  var organic = data.organic || [];
  var sourceUrl = (organic[0] && organic[0].link) ? organic[0].link : '';

  return {
    ok: true,
    address: addresses[0] || '',
    phone: phones[0] || '',
    email: emails[0] || '',
    website: urls[0] || '',
    source_url: sourceUrl
  };
}

function serperRunEnrichment(mode) {
  var props = serperGetProps();
  if (!props.SERPER_API_KEY) {
    SpreadsheetApp.getUi().alert('SERPER_API_KEY not set. Use Serper → Settings → Set API Key.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var cfg = serperGetSheetConfig(sheet);
  if (!cfg) {
    SpreadsheetApp.getUi().alert('Could not find Name (or First Name + Last Name), City, State columns.');
    return;
  }

  var toProcess = [];
  var data = cfg.data;

  if (mode === 'selected') {
    var selection = sheet.getActiveRange();
    if (!selection) {
      SpreadsheetApp.getUi().alert('Select the rows to enrich first.');
      return;
    }
    var selFirst = Math.max(2, selection.getRow());
    var selLast = selection.getLastRow();
    for (var r = selFirst; r <= selLast; r++) {
      toProcess.push({ rowIndex: r, data: data[r - 1] });
    }
  } else if (mode === 'empty') {
    for (var r = 2; r <= data.length; r++) {
      var row = data[r - 1];
      var addr = cfg.addrCol >= 0 ? String(row[cfg.addrCol] || '').trim() : '';
      var phone = cfg.phoneCol >= 0 ? String(row[cfg.phoneCol] || '').trim() : '';
      var email = cfg.emailCol >= 0 ? String(row[cfg.emailCol] || '').trim() : '';
      if (!addr && !phone && !email) {
        toProcess.push({ rowIndex: r, data: row });
      }
    }
  } else {
    for (var r = 2; r <= data.length; r++) {
      toProcess.push({ rowIndex: r, data: data[r - 1] });
    }
  }

  if (toProcess.length === 0) {
    SpreadsheetApp.getUi().alert(mode === 'empty' ? 'No empty rows to process.' : 'No rows to process.');
    return;
  }

  var batchSize = props.BATCH_SIZE;
  var limit = Math.min(toProcess.length, batchSize);
  var processed = 0;
  var startCol = cfg.addrCol + 1;

  for (var i = 0; i < limit; i++) {
    var item = toProcess[i];
    var r = item.rowIndex;
    var row = item.data;
    var name = serperGetRowName(cfg, row);
    var city = cfg.cityCol >= 0 ? String(row[cfg.cityCol] || '').trim() : '';
    var state = cfg.stateCol >= 0 ? String(row[cfg.stateCol] || '').trim() : '';

    var result = serperLookup(name, city, state, props);

    var vals;
    if (result.ok) {
      vals = [result.address, result.phone, result.email, result.website, result.source_url, new Date().toISOString()];
      processed++;
    } else {
      vals = ['', '', '', '', '', new Date().toISOString()];
    }

    sheet.getRange(r, startCol, r, startCol + 5).setValues([vals]);

    if (i < limit - 1) Utilities.sleep(props.REQUEST_DELAY_MS);
  }

  SpreadsheetApp.getUi().alert('Serper: processed ' + processed + ' of ' + limit + ' rows. Review the data, then optionally run TracerFY on selected rows.');
}

function serperEnrichAll() { serperRunEnrichment('all'); }
function serperEnrichSelected() { serperRunEnrichment('selected'); }
function serperEnrichEmpty() { serperRunEnrichment('empty'); }
