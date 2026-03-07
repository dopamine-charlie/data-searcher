const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const configSection = document.getElementById('configSection');
const progressSection = document.getElementById('progressSection');
const resultSection = document.getElementById('resultSection');
const errorSection = document.getElementById('errorSection');

const nameModeFull = document.getElementById('nameModeFull');
const nameModeFirstLast = document.getElementById('nameModeFirstLast');
const nameFullField = document.getElementById('nameFullField');
const nameFirstLastField = document.getElementById('nameFirstLastField');
const nameCol = document.getElementById('nameCol');
const firstNameCol = document.getElementById('firstNameCol');
const lastNameCol = document.getElementById('lastNameCol');
const cityCol = document.getElementById('cityCol');
const stateCol = document.getElementById('stateCol');
const limitSelect = document.getElementById('limit');
const rowCountEl = document.getElementById('rowCount');

const enrichBtn = document.getElementById('enrichBtn');
const btnText = enrichBtn.querySelector('.btn-text');
const btnLoading = enrichBtn.querySelector('.btn-loading');
const changeFileBtn = document.getElementById('changeFile');
const enrichAnotherBtn = document.getElementById('enrichAnother');
const downloadBtn = document.getElementById('downloadBtn');
const dismissErrorBtn = document.getElementById('dismissError');
const resultStats = document.getElementById('resultStats');
const errorMessage = document.getElementById('errorMessage');
const progressStatus = document.getElementById('progressStatus');
const progressBar = document.getElementById('progressBar');
const progressDetail = document.getElementById('progressDetail');

let currentFileContent = null;
let currentHeaders = [];
let currentRowCount = 0;

// Dropzone
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith('.csv')) {
    handleFile(file);
  } else {
    showError('Please drop a CSV file.');
  }
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    currentFileContent = content;

    try {
      const res = await fetch('/api/columns', {
        method: 'POST',
        body: (() => {
          const fd = new FormData();
          fd.append('file', file);
          return fd;
        })(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse CSV');

      currentHeaders = data.headers;
      currentRowCount = data.rowCount;
      rowCountEl.textContent = `${data.rowCount} rows found`;
      updateAllRowsOption(data.rowCount);
      populateSelects(data.headers);
      uploadSection.classList.add('hidden');
      configSection.classList.remove('hidden');
      errorSection.classList.add('hidden');
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsText(file);
}

function populateSelects(headers) {
  const opts = headers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
  nameCol.innerHTML = opts;
  firstNameCol.innerHTML = opts;
  lastNameCol.innerHTML = opts;
  cityCol.innerHTML = opts;
  stateCol.innerHTML = opts;
  // Smart defaults
  const fullNameIdx = headers.findIndex((h) => {
    const x = h.toLowerCase();
    return x.includes('name') && !x.includes('first') && !x.includes('last');
  });
  const firstIdx = headers.findIndex((h) => {
    const x = h.toLowerCase();
    return x.includes('first') || x === 'firstname';
  });
  const lastIdx = headers.findIndex((h) => {
    const x = h.toLowerCase();
    return x.includes('last') || x === 'lastname';
  });
  const cityIdx = headers.findIndex((h) => h.toLowerCase().includes('city'));
  const stateIdx = headers.findIndex((h) => h.toLowerCase().includes('state'));
  if (fullNameIdx >= 0) nameCol.selectedIndex = fullNameIdx;
  else if (firstIdx >= 0) nameCol.selectedIndex = firstIdx;
  if (firstIdx >= 0) firstNameCol.selectedIndex = firstIdx;
  if (lastIdx >= 0) lastNameCol.selectedIndex = lastIdx;
  if (cityIdx >= 0) cityCol.selectedIndex = cityIdx;
  if (stateIdx >= 0) stateCol.selectedIndex = stateIdx;
  // Pick mode based on headers
  if (firstIdx >= 0 && lastIdx >= 0) {
    nameModeFirstLast.checked = true;
    toggleNameFields();
  } else {
    nameModeFull.checked = true;
    toggleNameFields();
  }
}

function toggleNameFields() {
  const isFirstLast = nameModeFirstLast.checked;
  nameFullField.classList.toggle('hidden', isFirstLast);
  nameFirstLastField.classList.toggle('hidden', !isFirstLast);
  document.getElementById('lastNameField').classList.toggle('hidden', !isFirstLast);
}

nameModeFull.addEventListener('change', toggleNameFields);
nameModeFirstLast.addEventListener('change', toggleNameFields);

function updateAllRowsOption(count) {
  const allOpt = limitSelect.querySelector('option[value="all"]');
  if (allOpt) allOpt.textContent = `All rows (${count})`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

changeFileBtn.addEventListener('click', () => {
  currentFileContent = null;
  configSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  fileInput.value = '';
});

enrichBtn.addEventListener('click', async () => {
  if (!currentFileContent) return;
  configSection.classList.add('hidden');
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressDetail.textContent = '0 / 0 rows';
  errorSection.classList.add('hidden');
  enrichBtn.disabled = true;
  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');

  const limitVal = limitSelect.value;
  const limit = limitVal === 'all' ? currentRowCount : parseInt(limitVal, 10);
  const payload = {
    file: currentFileContent,
    cityCol: cityCol.value,
    stateCol: stateCol.value,
    limit,
  };
  if (nameModeFirstLast.checked) {
    payload.firstNameCol = firstNameCol.value;
    payload.lastNameCol = lastNameCol.value;
  } else {
    payload.nameCol = nameCol.value;
  }

  try {
    const startRes = await fetch('/api/enrich/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || 'Failed to start enrichment');

    const jobId = startData.jobId;

    const poll = () =>
      new Promise((resolve, reject) => {
        const check = async () => {
          try {
            const statusRes = await fetch(`/api/enrich/status/${jobId}`);
            const status = await statusRes.json();
            if (!statusRes.ok) return reject(new Error(status.error || 'Status check failed'));

            const { current = 0, total = 0, stage = 'serper', status: jobStatus } = status;
            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressDetail) progressDetail.textContent = `${current} / ${total} rows`;
            if (progressStatus) {
              if (stage === 'serper') {
                progressStatus.textContent = `Searching Serper… (${current}/${total})`;
              } else {
                progressStatus.textContent = `Searching DuckDuckGo… (${current}/${total})`;
              }
            }

            if (jobStatus === 'done') {
              const blob = new Blob([status.csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              downloadBtn.href = url;
              downloadBtn.download = 'enriched.csv';
              resultStats.textContent = `Processed ${status.processed} rows • Enriched ${status.enriched} with at least one field`;
              progressSection.classList.add('hidden');
              resultSection.classList.remove('hidden');
              resolve();
              return;
            }
            if (jobStatus === 'error') {
              return reject(new Error(status.error || 'Enrichment failed'));
            }
            setTimeout(check, 500);
          } catch (e) {
            reject(e);
          }
        };
        check();
      });

    await poll();
  } catch (err) {
    progressSection.classList.add('hidden');
    configSection.classList.remove('hidden');
    showError(err.message);
  } finally {
    enrichBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
});

enrichAnotherBtn.addEventListener('click', () => {
  resultSection.classList.add('hidden');
  currentFileContent = null;
  uploadSection.classList.remove('hidden');
  fileInput.value = '';
});

dismissErrorBtn.addEventListener('click', () => {
  errorSection.classList.add('hidden');
});

function showError(msg) {
  errorMessage.textContent = msg;
  errorSection.classList.remove('hidden');
}
