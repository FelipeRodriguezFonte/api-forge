const qs = new URLSearchParams(window.location.search);
const historyId = qs.get('id');

const requestTextEl = document.getElementById('request-text');
const responseTextEl = document.getElementById('response-text');
const requestMetaEl = document.getElementById('request-meta');
const responseMetaEl = document.getElementById('response-meta');
const responsePill = document.getElementById('response-pill');
const historyTitle = document.getElementById('history-title');
const historySubtitle = document.getElementById('history-subtitle');
const varsCaptured = document.getElementById('vars-captured');

const btnCopyRequest = document.getElementById('btn-copy-request');
const btnCopyResponse = document.getElementById('btn-copy-response');

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatRequest(entry) {
  const req = entry.request || {};
  const lines = [];
  lines.push(`${req.method || 'GET'} ${req.url || ''}`);
  lines.push('');
  lines.push('Headers:');
  lines.push(JSON.stringify(req.headers || {}, null, 2));
  if (Array.isArray(req.query) && req.query.length > 0) {
    lines.push('');
    lines.push('Query:');
    lines.push(JSON.stringify(req.query, null, 2));
  }
  if (req.bodyText) {
    lines.push('');
    lines.push('Body:');
    lines.push(prettyJson(req.bodyText));
  }
  return lines.join('\n');
}

function formatResponse(entry) {
  const res = entry.response || {};
  const lines = [];
  lines.push(`Status ${res.status || '--'} ${res.statusText || ''}`.trim());
  lines.push('');
  lines.push('Headers:');
  lines.push(JSON.stringify(res.headers || {}, null, 2));
  if (res.body) {
    lines.push('');
    lines.push('Body:');
    lines.push(prettyJson(res.body));
  }
  return lines.join('\n');
}

async function init() {
  if (!window.app?.getHistory || !historyId) {
    requestTextEl.textContent = 'No hay datos.';
    responseTextEl.textContent = 'No hay datos.';
    return;
  }

  const entry = await window.app.getHistory(historyId);
  if (!entry) {
    requestTextEl.textContent = 'Historial no encontrado.';
    responseTextEl.textContent = 'Historial no encontrado.';
    return;
  }

  historyTitle.textContent = entry.name || 'Detalle de request';
  historySubtitle.textContent = `${entry.method} · ${new Date(entry.ts).toLocaleString()}`;

  requestMetaEl.textContent = entry.request?.url || entry.url || '';
  responseMetaEl.textContent = `${entry.elapsedMs || '--'} ms`;

  const status = entry.response?.status || entry.status;
  responsePill.textContent = status || '--';
  responsePill.style.background = status >= 400 ? 'rgba(255, 122, 162, 0.2)' : 'rgba(86, 210, 255, 0.2)';
  responsePill.style.color = status >= 400 ? '#ff7aa2' : 'var(--accent-2)';

  const requestText = formatRequest(entry);
  const responseText = formatResponse(entry);

  requestTextEl.textContent = requestText;
  responseTextEl.textContent = responseText;

  btnCopyRequest.onclick = async () => {
    await window.app.writeClipboard(requestText);
    btnCopyRequest.textContent = 'Copiado';
    setTimeout(() => (btnCopyRequest.textContent = 'Copiar request'), 1200);
  };

  btnCopyResponse.onclick = async () => {
    await window.app.writeClipboard(responseText);
    btnCopyResponse.textContent = 'Copiado';
    setTimeout(() => (btnCopyResponse.textContent = 'Copiar respuesta'), 1200);
  };

  if (entry.vars && entry.vars.length > 0) {
    varsCaptured.classList.remove('hidden');
    varsCaptured.textContent = `Variables capturadas: ${entry.vars
      .map((v) => `${v.key}=${v.value}`)
      .join(', ')}`;
  }
}

init();
