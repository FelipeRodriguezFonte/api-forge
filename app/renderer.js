const $ = (id) => document.getElementById(id);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const defaultState = () => ({
  settings: {
    timeoutMs: 15000,
    maxSizeBytes: 5 * 1024 * 1024,
    proxyUrl: '',
    allowInsecureSSL: false
  },
  globals: [],
  presets: [],
  environments: [createEnvironment('Default', 'https://httpbin.org')],
  activeEnvironmentId: null
});

let state = null;
let saveTimer = null;
const defaultSettings = defaultState().settings;
let requestFilter = '';

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultRequest() {
  return {
    id: id(),
    name: 'Nueva Request',
    method: 'GET',
    url: '{{baseUrl}}/get',
    headers: [{ id: id(), key: 'Content-Type', value: 'application/json', enabled: true }],
    query: [],
    body: { type: 'json', text: '{\n  "hello": "world"\n}' },
    auth: { type: 'none', token: '' },
    extractors: []
  };
}

function createEnvironment(name, baseUrl = '') {
  const env = {
    id: id(),
    name: name || 'Entorno',
    vars: [{ id: id(), key: 'baseUrl', value: baseUrl, enabled: true }],
    requests: [createDefaultRequest()],
    activeRequestId: null,
    history: []
  };
  env.activeRequestId = env.requests[0].id;
  return env;
}

function normalizeVars(list) {
  if (!Array.isArray(list)) return [];
  return list.map((v) => ({
    id: v?.id || id(),
    key: v?.key || '',
    value: v?.value ?? '',
    enabled: v?.enabled !== false
  }));
}

function normalizeRequest(req) {
  const base = createDefaultRequest();
  const out = { ...base, ...(req || {}) };
  out.id = req?.id || base.id;
  out.headers = normalizeVars(req?.headers);
  out.query = normalizeVars(req?.query);
  out.body = { ...base.body, ...(req?.body || {}) };
  out.auth = { ...base.auth, ...(req?.auth || {}) };
  out.extractors = Array.isArray(req?.extractors)
    ? req.extractors.map((ex) => ({
        id: ex?.id || id(),
        type: ex?.type || 'header',
        source: ex?.source || '',
        target: ex?.target || ''
      }))
    : [];
  return out;
}

function normalizeState(raw) {
  const base = defaultState();
  let s = raw && typeof raw === 'object' ? raw : base;

  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.globals = normalizeVars(s.globals);
  s.presets = Array.isArray(s.presets)
    ? s.presets.map((p) => ({
        id: p?.id || id(),
        name: p?.name || 'Preset',
        envNames: Array.isArray(p?.envNames) ? p.envNames : []
      }))
    : [];

  if (!Array.isArray(s.environments) || s.environments.length === 0) {
    s.environments = base.environments;
  }

  if (Array.isArray(s.requests)) {
    const firstEnv = s.environments[0] || base.environments[0];
    firstEnv.requests = s.requests.map(normalizeRequest);
    firstEnv.activeRequestId = s.activeRequestId || firstEnv.requests[0]?.id || null;
    s.environments[0] = firstEnv;
    delete s.requests;
    delete s.activeRequestId;
  }

  s.environments = s.environments.map((env) => {
    const next = { ...env };
    next.id = env?.id || id();
    next.name = env?.name || 'Entorno';
    next.vars = normalizeVars(env?.vars);
    next.requests = Array.isArray(env?.requests) && env.requests.length > 0
      ? env.requests.map(normalizeRequest)
      : [createDefaultRequest()];
    next.activeRequestId = env?.activeRequestId || next.requests[0]?.id || null;
    next.history = Array.isArray(env?.history) ? env.history : [];
    return next;
  });

  if (!s.activeEnvironmentId || !s.environments.find((env) => env.id === s.activeEnvironmentId)) {
    s.activeEnvironmentId = s.environments[0]?.id || null;
  }

  return s;
}

function normalizeEnvironmentForImport(rawEnv) {
  const fallback = createEnvironment('Entorno importado', '');
  const env = rawEnv && typeof rawEnv === 'object' ? rawEnv : {};
  const next = { ...fallback, ...env };
  next.id = id();
  next.name = env?.name || fallback.name;
  next.vars = normalizeVars(env?.vars);
  if (!next.vars.find((v) => v.key === 'baseUrl')) {
    next.vars.unshift({ id: id(), key: 'baseUrl', value: '', enabled: true });
  }
  next.requests = Array.isArray(env?.requests) && env.requests.length > 0
    ? env.requests.map(normalizeRequest)
    : [createDefaultRequest()];
  next.activeRequestId = next.requests[0]?.id || null;
  next.history = [];
  return next;
}

function cloneRequest(req) {
  const base = normalizeRequest(req);
  base.id = id();
  base.headers = normalizeVars(base.headers).map((h) => ({ ...h, id: id() }));
  base.query = normalizeVars(base.query).map((q) => ({ ...q, id: id() }));
  base.extractors = (base.extractors || []).map((ex) => ({ ...ex, id: id() }));
  return base;
}

function cloneEnvironment(env) {
  const name = env?.name ? `${env.name} copia` : 'Entorno copia';
  const cloned = createEnvironment(name, '');
  cloned.vars = normalizeVars(env?.vars).map((v) => ({ ...v, id: id() }));
  if (!cloned.vars.find((v) => v.key === 'baseUrl')) {
    cloned.vars.unshift({ id: id(), key: 'baseUrl', value: '', enabled: true });
  }
  cloned.requests = Array.isArray(env?.requests) && env.requests.length > 0
    ? env.requests.map(cloneRequest)
    : [createDefaultRequest()];
  cloned.activeRequestId = cloned.requests[0]?.id || null;
  cloned.history = [];
  return cloned;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (window.app?.writeState) {
      await window.app.writeState(state);
    }
  }, 300);
}

function getActiveEnv() {
  return state.environments.find((env) => env.id === state.activeEnvironmentId);
}

function getActiveReq() {
  const env = getActiveEnv();
  if (!env) return null;
  return env.requests.find((req) => req.id === env.activeRequestId) || env.requests[0] || null;
}

function setActiveReq(idValue) {
  const env = getActiveEnv();
  if (!env) return;
  env.activeRequestId = idValue;
  render();
  scheduleSave();
}

function setActiveEnv(idValue) {
  state.activeEnvironmentId = idValue;
  const env = getActiveEnv();
  if (env && (!env.requests || env.requests.length === 0)) {
    env.requests = [createDefaultRequest()];
    env.activeRequestId = env.requests[0].id;
  }
  render();
  scheduleSave();
}

function applyEnv(input) {
  const env = getActiveEnv();
  let output = String(input || '');
  const envVars = env?.vars || [];
  const globalVars = state?.globals || [];

  for (const v of globalVars) {
    if (!v.enabled) continue;
    const token = `{{${v.key}}}`;
    output = output.split(token).join(v.value ?? '');
  }

  for (const v of envVars) {
    if (!v.enabled) continue;
    const token = `{{${v.key}}}`;
    output = output.split(token).join(v.value ?? '');
  }
  return output;
}

function renderSelect(select, options, value) {
  select.innerHTML = '';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === value) option.selected = true;
    select.appendChild(option);
  }
}

function renderEnvSelect() {
  const select = $('env-select');
  select.innerHTML = '';
  for (const env of state.environments) {
    const option = document.createElement('option');
    option.value = env.id;
    option.textContent = env.name;
    if (env.id === state.activeEnvironmentId) option.selected = true;
    select.appendChild(option);
  }
  select.onchange = (e) => setActiveEnv(e.target.value);
}

function renderEnvMeta() {
  const env = getActiveEnv();
  const input = $('env-name');
  if (!env || !input) return;
  input.value = env.name || '';
  input.oninput = (e) => {
    env.name = e.target.value;
    renderEnvSelect();
    scheduleSave();
  };

  const deleteBtn = $('btn-delete-env');
  if (deleteBtn) {
    deleteBtn.disabled = state.environments.length <= 1;
  }
}

function renderRequestSelect() {
  const select = $('request-select');
  const env = getActiveEnv();
  if (!select || !env) return;
  select.innerHTML = '';
  for (const req of env.requests) {
    const option = document.createElement('option');
    option.value = req.id;
    option.textContent = req.name || 'Sin nombre';
    if (req.id === env.activeRequestId) option.selected = true;
    select.appendChild(option);
  }
  select.onchange = (e) => setActiveReq(e.target.value);
}

function renderRequests() {
  const list = $('request-list');
  list.innerHTML = '';
  const env = getActiveEnv();
  if (!env) return;
  const filter = requestFilter.trim().toLowerCase();
  const visible = filter
    ? env.requests.filter((req) => {
        const haystack = `${req.name || ''} ${req.url || ''} ${req.method || ''}`.toLowerCase();
        return haystack.includes(filter);
      })
    : env.requests;

  for (const req of visible) {
    const item = document.createElement('div');
    item.className = `request-item ${req.id === env.activeRequestId ? 'active' : ''}`;
    const title = document.createElement('div');
    title.textContent = req.name || 'Sin nombre';
    const actions = document.createElement('div');
    actions.className = 'request-actions';

    const pill = document.createElement('span');
    pill.className = 'method-pill';
    pill.textContent = req.method;

    const del = document.createElement('button');
    del.className = 'request-delete';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Eliminar request';
    del.onclick = (event) => {
      event.stopPropagation();
      const ok = window.confirm(`Eliminar request "${req.name || 'Sin nombre'}"?`);
      if (!ok) return;
      env.requests = env.requests.filter((r) => r.id !== req.id);
      if (!env.requests.length) {
        env.requests = [createDefaultRequest()];
      }
      if (!env.requests.find((r) => r.id === env.activeRequestId)) {
        env.activeRequestId = env.requests[0].id;
      }
      render();
      scheduleSave();
    };

    actions.appendChild(pill);
    actions.appendChild(del);

    item.appendChild(title);
    item.appendChild(actions);
    item.onclick = () => setActiveReq(req.id);
    list.appendChild(item);
  }

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'request-item';
    empty.textContent = 'Sin resultados.';
    list.appendChild(empty);
  }
}

function renderVars() {
  const list = $('vars-list');
  list.innerHTML = '';
  const env = getActiveEnv();
  if (!env) return;
  for (const variable of env.vars) {
    const row = document.createElement('div');
    row.className = 'kv-row';

    const key = document.createElement('input');
    key.className = 'input';
    key.value = variable.key;
    key.placeholder = 'key';
    key.oninput = (e) => {
      variable.key = e.target.value;
      scheduleSave();
    };

    const value = document.createElement('input');
    value.className = 'input';
    value.value = variable.value;
    value.placeholder = 'value';
    value.oninput = (e) => {
      variable.value = e.target.value;
      scheduleSave();
    };

    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => {
      env.vars = env.vars.filter((v) => v.id !== variable.id);
      renderVars();
      scheduleSave();
    };

    row.appendChild(key);
    row.appendChild(value);
    row.appendChild(del);
    list.appendChild(row);
  }
}

function renderGlobalVars() {
  const list = $('global-vars-list');
  if (!list) return;
  list.innerHTML = '';
  const globals = state.globals || [];
  for (const variable of globals) {
    const row = document.createElement('div');
    row.className = 'kv-row';

    const key = document.createElement('input');
    key.className = 'input';
    key.value = variable.key;
    key.placeholder = 'key';
    key.oninput = (e) => {
      variable.key = e.target.value;
      scheduleSave();
    };

    const value = document.createElement('input');
    value.className = 'input';
    value.value = variable.value;
    value.placeholder = 'value';
    value.oninput = (e) => {
      variable.value = e.target.value;
      scheduleSave();
    };

    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => {
      state.globals = state.globals.filter((v) => v.id !== variable.id);
      renderGlobalVars();
      scheduleSave();
    };

    row.appendChild(key);
    row.appendChild(value);
    row.appendChild(del);
    list.appendChild(row);
  }
}

function renderRequestEditor() {
  const req = getActiveReq();
  if (!req) return;

  const nameInput = $('request-name');
  if (nameInput) {
    nameInput.value = req.name || '';
    nameInput.oninput = (e) => {
      req.name = e.target.value;
      scheduleSave();
      renderRequests();
      renderRequestSelect();
    };
  }

  renderSelect($('method'), METHODS, req.method);
  $('method').onchange = (e) => {
    req.method = e.target.value;
    scheduleSave();
    renderRequests();
  };

  $('url').value = req.url || '';
  $('url').oninput = (e) => {
    req.url = e.target.value;
    scheduleSave();
  };

  renderKeyValueTab('tab-headers', req.headers, 'Header');
  renderKeyValueTab('tab-query', req.query, 'Param');
  renderBodyTab(req);
  renderAuthTab(req);
  renderExtractTab(req);
}

function renderKeyValueTab(containerId, items, label) {
  const container = $(containerId);
  container.innerHTML = '';

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'kv-row';

    const key = document.createElement('input');
    key.className = 'input';
    key.placeholder = `${label} key`;
    key.value = item.key;
    key.oninput = (e) => {
      item.key = e.target.value;
      scheduleSave();
    };

    const value = document.createElement('input');
    value.className = 'input';
    value.placeholder = `${label} value`;
    value.value = item.value;
    value.oninput = (e) => {
      item.value = e.target.value;
      scheduleSave();
    };

    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => {
      const idx = items.findIndex((v) => v.id === item.id);
      if (idx >= 0) items.splice(idx, 1);
      renderKeyValueTab(containerId, items, label);
      scheduleSave();
    };

    row.appendChild(key);
    row.appendChild(value);
    row.appendChild(del);
    container.appendChild(row);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-small';
  add.textContent = `Agregar ${label}`;
  add.onclick = () => {
    items.push({ id: id(), key: '', value: '', enabled: true });
    renderKeyValueTab(containerId, items, label);
    scheduleSave();
  };
  container.appendChild(add);
}

function renderBodyTab(req) {
  const container = $('tab-body');
  container.innerHTML = '';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'select';
  ['json', 'text'].forEach((t) => {
    const option = document.createElement('option');
    option.value = t;
    option.textContent = t.toUpperCase();
    if (req.body.type === t) option.selected = true;
    typeSelect.appendChild(option);
  });
  typeSelect.onchange = (e) => {
    req.body.type = e.target.value;
    scheduleSave();
  };

  const textarea = document.createElement('textarea');
  textarea.className = 'input';
  textarea.style.minHeight = '160px';
  textarea.style.resize = 'vertical';
  textarea.value = req.body.text || '';
  textarea.oninput = (e) => {
    req.body.text = e.target.value;
    scheduleSave();
  };

  container.appendChild(typeSelect);
  container.appendChild(textarea);
}

function renderAuthTab(req) {
  const container = $('tab-auth');
  container.innerHTML = '';

  const select = document.createElement('select');
  select.className = 'select';
  ['none', 'bearer'].forEach((t) => {
    const option = document.createElement('option');
    option.value = t;
    option.textContent = t.toUpperCase();
    if (req.auth.type === t) option.selected = true;
    select.appendChild(option);
  });
  select.onchange = (e) => {
    req.auth.type = e.target.value;
    scheduleSave();
    renderAuthTab(req);
  };

  container.appendChild(select);

  if (req.auth.type === 'bearer') {
    const token = document.createElement('input');
    token.className = 'input';
    token.placeholder = 'Token';
    token.value = req.auth.token || '';
    token.oninput = (e) => {
      req.auth.token = e.target.value;
      scheduleSave();
    };
    container.appendChild(token);
  }
}

function renderExtractTab(req) {
  const container = $('tab-extract');
  if (!container) return;
  container.innerHTML = '';

  const extractors = req.extractors || (req.extractors = []);

  for (const ex of extractors) {
    const row = document.createElement('div');
    row.className = 'extract-row';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'select';
    const options = [
      { value: 'header', label: 'Header' },
      { value: 'json', label: 'JSON' }
    ];
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (ex.type === opt.value) option.selected = true;
      typeSelect.appendChild(option);
    }
    typeSelect.onchange = (e) => {
      ex.type = e.target.value;
      renderExtractTab(req);
      scheduleSave();
    };

    const source = document.createElement('input');
    source.className = 'input';
    source.placeholder = ex.type === 'header'
      ? 'Header (ej: authorization)'
      : 'JSONPath (ej: $.data.token, $.items[0].id, $.items[*].id)';
    source.value = ex.source || '';
    source.oninput = (e) => {
      ex.source = e.target.value;
      scheduleSave();
    };

    const target = document.createElement('input');
    target.className = 'input';
    target.placeholder = 'Variable destino (ej: token)';
    target.value = ex.target || '';
    target.oninput = (e) => {
      ex.target = e.target.value;
      scheduleSave();
    };

    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => {
      const idx = extractors.findIndex((v) => v.id === ex.id);
      if (idx >= 0) extractors.splice(idx, 1);
      renderExtractTab(req);
      scheduleSave();
    };

    row.appendChild(typeSelect);
    row.appendChild(source);
    row.appendChild(target);
    row.appendChild(del);
    container.appendChild(row);
  }

  const add = document.createElement('button');
  add.className = 'btn btn-small';
  add.textContent = 'Agregar regla';
  add.onclick = () => {
    extractors.push({ id: id(), type: 'header', source: '', target: '' });
    renderExtractTab(req);
    scheduleSave();
  };
  container.appendChild(add);
}

function setResponse(meta, headersText, bodyText, statusOk) {
  $('response-meta').textContent = meta || 'Sin datos.';
  $('response-headers').textContent = headersText || '';
  $('response-body').textContent = bodyText || '';
  const pill = $('status-pill');
  pill.textContent = statusOk?.label || '--';
  pill.style.background = statusOk?.color || 'rgba(86, 210, 255, 0.2)';
  pill.style.color = statusOk?.text || 'var(--accent-2)';
}

function renderHistory() {
  const list = $('history-list');
  if (!list) return;
  list.innerHTML = '';
  const env = getActiveEnv();
  const history = env?.history || [];

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-item';
    empty.textContent = 'Sin historial.';
    list.appendChild(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.onclick = () => {
      if (entry.requestId) setActiveReq(entry.requestId);
      if (window.app?.openHistory) {
        window.app.openHistory(entry);
      }
    };

    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const time = new Date(entry.ts).toLocaleTimeString();
    const left = document.createElement('div');
    left.textContent = `${time} · ${entry.method} · ${entry.name}`;

    const right = document.createElement('div');
    right.textContent = `${entry.status} · ${entry.elapsedMs} ms`;
    if (entry.status >= 400) {
      right.style.color = '#ff7aa2';
    } else {
      right.style.color = 'var(--accent-2)';
    }

    meta.appendChild(left);
    meta.appendChild(right);

    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.textContent = entry.url;

    item.appendChild(meta);
    item.appendChild(sub);

    if (entry.vars && entry.vars.length > 0) {
      const vars = document.createElement('div');
      vars.className = 'history-vars';
      vars.textContent = `vars: ${entry.vars.map((v) => `${v.key}=${v.value}`).join(', ')}`;
      item.appendChild(vars);
    }

    list.appendChild(item);
  }
}

let envModalHandler = null;

function hideEnvModal(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
  modal.style.opacity = '0';
  modal.style.pointerEvents = 'none';
}

function ensureEnvModalElements() {
  let modal = $('env-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'env-modal';
    modal.className = 'modal hidden';

    const content = document.createElement('div');
    content.className = 'modal__content modal__content--wide';

    const header = document.createElement('div');
    header.className = 'modal__header';

    const title = document.createElement('h2');
    title.id = 'env-modal-title';
    title.textContent = 'Exportar entornos';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'btn-close-env-modal';
    closeBtn.className = 'btn btn-ghost';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cerrar';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.id = 'env-modal-body';
    body.className = 'modal__body';

    const footer = document.createElement('div');
    footer.className = 'modal__footer';

    const primary = document.createElement('button');
    primary.id = 'btn-env-modal-primary';
    primary.className = 'btn btn-primary';
    primary.type = 'button';
    primary.textContent = 'Continuar';

    footer.appendChild(primary);

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    closeBtn.onclick = () => hideEnvModal(modal);
    modal.onclick = (event) => {
      if (event.target === modal) hideEnvModal(modal);
    };
  }

  return {
    modal,
    titleEl: $('env-modal-title'),
    body: $('env-modal-body'),
    confirmBtn: $('btn-env-modal-primary')
  };
}

function showEnvModal({ title, bodyEl, confirmText, onConfirm }) {
  const { modal, titleEl, body, confirmBtn } = ensureEnvModalElements();
  if (!modal || !titleEl || !body || !confirmBtn) {
    window.alert('No se pudo abrir el selector de entornos.');
    return false;
  }

  const closeBtn = $('btn-close-env-modal');
  if (closeBtn) {
    closeBtn.onclick = () => hideEnvModal(modal);
  }

  titleEl.textContent = title;
  body.innerHTML = '';
  body.appendChild(bodyEl);
  confirmBtn.textContent = confirmText || 'Continuar';

  if (envModalHandler) {
    confirmBtn.removeEventListener('click', envModalHandler);
  }
  envModalHandler = async () => {
    const shouldClose = await onConfirm();
    if (shouldClose !== false) {
      hideEnvModal(modal);
    }
  };
  confirmBtn.addEventListener('click', envModalHandler);

  modal.classList.remove('hidden');
  modal.style.display = 'grid';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';
  modal.style.zIndex = '9999';
  return true;
}

function createListItemWithInput({ id, label, meta, type = 'checkbox', name, checked = false }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'env-list__item';
  wrapper.setAttribute('for', id);

  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  if (name) input.name = name;
  input.checked = checked;

  const text = document.createElement('div');
  text.textContent = label;

  wrapper.appendChild(input);
  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'env-list__meta';
    metaEl.textContent = meta;
    const container = document.createElement('div');
    container.appendChild(text);
    container.appendChild(metaEl);
    wrapper.appendChild(container);
  } else {
    wrapper.appendChild(text);
  }

  return { wrapper, input };
}

function openExportModal(defaultSelection = 'env') {
  try {
    const environments = Array.isArray(state?.environments)
      ? state.environments.filter((e) => e && typeof e === 'object')
      : [];
    let env = getActiveEnv();
    if (!env && environments.length) {
      env = environments[0];
      state.activeEnvironmentId = env.id;
    }
    if (!env) {
      window.alert('No hay entornos disponibles para exportar.');
      return false;
    }

    const container = document.createElement('div');
    container.className = 'env-list';

    const selectAll = createListItemWithInput({
      id: 'export-select-all',
      label: 'Seleccionar todo',
      type: 'checkbox',
      checked: defaultSelection === 'all'
    });

    container.appendChild(selectAll.wrapper);

    const items = environments.map((current, idx) => {
      const isActive = current.id === env.id;
      const checked =
        defaultSelection === 'all' || (defaultSelection === 'env' ? isActive : false);
      const reqCount = Array.isArray(current.requests) ? current.requests.length : 0;
      const varsCount = Array.isArray(current.vars) ? current.vars.length : 0;
      return createListItemWithInput({
        id: `export-env-${idx}`,
        label: current.name || `Entorno ${idx + 1}`,
        meta: `${reqCount} requests · ${varsCount} variables`,
        type: 'checkbox',
        checked
      });
    });

    items.forEach((item) => container.appendChild(item.wrapper));

    selectAll.input.onchange = () => {
      items.forEach((item) => {
        item.input.checked = selectAll.input.checked;
      });
    };

    const includeGlobals = createListItemWithInput({
      id: 'export-globals',
      label: `Incluir variables globales (${(state.globals || []).length})`,
      type: 'checkbox',
      checked: true
    });
    container.appendChild(includeGlobals.wrapper);

    const presetSection = document.createElement('div');
    presetSection.className = 'env-section';

    const presetHeader = document.createElement('div');
    presetHeader.className = 'env-section__header';
    presetHeader.textContent = 'Presets (entornos frecuentes)';
    presetSection.appendChild(presetHeader);

    const presetList = document.createElement('div');
    presetList.className = 'preset-list';
    presetSection.appendChild(presetList);

    const presetControls = document.createElement('div');
    presetControls.className = 'preset-controls';
    const presetInput = document.createElement('input');
    presetInput.className = 'input';
    presetInput.placeholder = 'Nombre del preset';
    const presetSave = document.createElement('button');
    presetSave.className = 'btn btn-small';
    presetSave.type = 'button';
    presetSave.textContent = 'Guardar preset';
    presetControls.appendChild(presetInput);
    presetControls.appendChild(presetSave);
    presetSection.appendChild(presetControls);

    container.appendChild(presetSection);

    const renderPresets = () => {
      presetList.innerHTML = '';
      if (!state.presets || state.presets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'env-list__meta';
        empty.textContent = 'Sin presets guardados.';
        presetList.appendChild(empty);
        return;
      }

      state.presets.forEach((preset) => {
        const chip = document.createElement('button');
        chip.className = 'preset-chip';
        chip.type = 'button';
        chip.textContent = preset.name;
        chip.onclick = () => {
          const names = (preset.envNames || []).map((n) => n.toLowerCase());
          items.forEach((item, idx) => {
            const envName = (environments[idx]?.name || '').toLowerCase();
            item.input.checked = names.includes(envName);
          });
        };
        presetList.appendChild(chip);
      });
    };

    presetSave.onclick = () => {
      const name = presetInput.value.trim();
      if (!name) {
        window.alert('Escribe un nombre para el preset.');
        return;
      }
      const selectedNames = environments
        .filter((_env, idx) => items[idx].input.checked)
        .map((e) => e.name || 'Entorno');
      if (selectedNames.length === 0) {
        window.alert('Selecciona al menos un entorno.');
        return;
      }
      state.presets = state.presets || [];
      const existing = state.presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.envNames = selectedNames;
      } else {
        state.presets.push({ id: id(), name, envNames: selectedNames });
      }
      presetInput.value = '';
      renderPresets();
      scheduleSave();
    };

    renderPresets();

    return showEnvModal({
      title: 'Exportar entornos',
      bodyEl: container,
      confirmText: 'Exportar',
      onConfirm: async () => {
        const selected = environments.filter((_env, idx) => items[idx].input.checked);
        if (selected.length === 0) {
          window.alert('Selecciona al menos un entorno.');
          return false;
        }

        const safeName =
          selected.length === 1
            ? (selected[0].name || 'entorno')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '')
            : 'api-forge-entornos';

        const payload = {
          environments: selected
        };
        if (includeGlobals.input.checked) {
          payload.globals = state.globals || [];
        }

        await window.app.exportState({
          data: payload,
          defaultName: `${safeName || 'entorno'}.json`
        });
        return true;
      }
    });
  } catch (err) {
    console.error(err);
    window.alert(`Error en exportación: ${err?.message || err}`);
    return false;
  }
}

async function safeOpenExportModal(scope) {
  try {
    const opened = openExportModal(scope);
    if (opened) return;
    window.alert('No se pudo abrir el selector de exportación.');
  } catch (err) {
    console.error(err);
    window.alert('Error al abrir el selector de exportación.');
  }
}

async function openImportModal() {
  if (!window.app?.importState) return;
  const res = await window.app.importState();
  if (!res.ok) return;

  const data = res.data;
  let envs = [];
  if (Array.isArray(data?.environments)) {
    envs = data.environments;
  } else if (data) {
    envs = [data];
  }

  envs = envs.filter(Boolean);
  if (envs.length === 0) {
    window.alert('No se encontraron entornos en el archivo.');
    return;
  }

  const container = document.createElement('div');
  container.className = 'env-list';

  const selectAll = createListItemWithInput({
    id: 'import-select-all',
    label: 'Seleccionar todo',
    type: 'checkbox',
    checked: true
  });

  container.appendChild(selectAll.wrapper);

  const items = envs.map((env, idx) => {
    const name = env?.name || `Entorno ${idx + 1}`;
    const varsCount = Array.isArray(env?.vars) ? env.vars.length : 0;
    const reqCount = Array.isArray(env?.requests) ? env.requests.length : 0;
    return createListItemWithInput({
      id: `import-env-${idx}`,
      label: name,
      meta: `${reqCount} requests · ${varsCount} variables`,
      type: 'checkbox',
      checked: true
    });
  });

  items.forEach((item) => container.appendChild(item.wrapper));

  selectAll.input.onchange = () => {
    items.forEach((item) => {
      item.input.checked = selectAll.input.checked;
    });
  };

  const includeGlobals =
    Array.isArray(data?.globals) && data.globals.length > 0
      ? createListItemWithInput({
          id: 'import-globals',
          label: `Incluir variables globales (${data.globals.length})`,
          type: 'checkbox',
          checked: true
        })
      : null;

  if (includeGlobals) {
    container.appendChild(includeGlobals.wrapper);
  }

  const replaceAll = createListItemWithInput({
    id: 'import-replace-all',
    label: 'Reemplazar todos los entornos existentes',
    type: 'checkbox',
    checked: false
  });
  container.appendChild(replaceAll.wrapper);

  const presetSection = document.createElement('div');
  presetSection.className = 'env-section';
  const presetHeader = document.createElement('div');
  presetHeader.className = 'env-section__header';
  presetHeader.textContent = 'Presets (selección rápida)';
  const presetList = document.createElement('div');
  presetList.className = 'preset-list';
  presetSection.appendChild(presetHeader);
  presetSection.appendChild(presetList);
  container.appendChild(presetSection);

  const renderImportPresets = () => {
    presetList.innerHTML = '';
    if (!state.presets || state.presets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'env-list__meta';
      empty.textContent = 'Sin presets guardados.';
      presetList.appendChild(empty);
      return;
    }

    state.presets.forEach((preset) => {
      const chip = document.createElement('button');
      chip.className = 'preset-chip';
      chip.type = 'button';
      chip.textContent = preset.name;
      chip.onclick = () => {
        const names = (preset.envNames || []).map((n) => n.toLowerCase());
        items.forEach((item, idx) => {
          const envName = (envs[idx]?.name || '').toLowerCase();
          item.input.checked = names.includes(envName);
        });
      };
      presetList.appendChild(chip);
    });
  };
  renderImportPresets();

  showEnvModal({
    title: 'Importar entornos',
    bodyEl: container,
    confirmText: 'Importar',
    onConfirm: () => {
      const selected = envs.filter((_env, idx) => items[idx].input.checked);
      if (selected.length === 0) {
        window.alert('Selecciona al menos un entorno.');
        return false;
      }

      const imported = selected.map((env) => normalizeEnvironmentForImport(env));
      if (replaceAll.input.checked) {
        state.environments = imported;
      } else {
        state.environments.push(...imported);
      }
      state.activeEnvironmentId = state.environments[0]?.id || null;

      if (includeGlobals?.input.checked) {
        if (replaceAll.input.checked) {
          state.globals = normalizeVars(data.globals);
        } else {
          state.globals = state.globals || [];
          for (const g of normalizeVars(data.globals)) {
            const existing = state.globals.find((v) => v.key === g.key);
            if (existing) {
              existing.value = g.value;
              existing.enabled = g.enabled;
            } else {
              state.globals.push(g);
            }
          }
        }
      }

      render();
      scheduleSave();
      return true;
    }
  });
}

function buildHeaders(req) {
  const headers = {};
  for (const header of req.headers || []) {
    if (!header.key) continue;
    headers[applyEnv(header.key)] = applyEnv(header.value || '');
  }

  if (req.auth?.type === 'bearer' && req.auth.token) {
    headers['Authorization'] = `Bearer ${applyEnv(req.auth.token)}`;
  }

  if (req.body?.type === 'json') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return headers;
}

function buildUrl(req) {
  const rawUrl = applyEnv(req.url || '');
  const url = new URL(rawUrl);
  for (const param of req.query || []) {
    if (!param.key) continue;
    url.searchParams.set(applyEnv(param.key), applyEnv(param.value || ''));
  }
  return url.toString();
}

function tokenizeCurl(input) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && !inSingle) {
      escape = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseCurlCommand(command) {
  const tokens = tokenizeCurl(command);
  let method = null;
  let url = null;
  const headers = {};
  const dataParts = [];
  let getFlag = false;

  const takeNext = (i) => (i + 1 < tokens.length ? tokens[i + 1] : '');

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === 'curl') continue;
    if (t === '-X' || t === '--request') {
      method = takeNext(i).toUpperCase();
      i += 1;
      continue;
    }
    if (t === '-H' || t === '--header') {
      const header = takeNext(i);
      i += 1;
      const idx = header.indexOf(':');
      if (idx > 0) {
        const key = header.slice(0, idx).trim();
        const value = header.slice(idx + 1).trim();
        headers[key] = value;
      }
      continue;
    }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-urlencode') {
      const data = takeNext(i);
      i += 1;
      if (data) dataParts.push(data);
      continue;
    }
    if (t === '-G' || t === '--get') {
      getFlag = true;
      continue;
    }
    if (t === '--url') {
      url = takeNext(i);
      i += 1;
      continue;
    }
    if (t === '-I' || t === '--head') {
      method = 'HEAD';
      continue;
    }
    if (t === '-u' || t === '--user') {
      const userPass = takeNext(i);
      i += 1;
      if (userPass) {
        const encoded = btoa(userPass);
        headers['Authorization'] = `Basic ${encoded}`;
      }
      continue;
    }
    if (t.startsWith('http://') || t.startsWith('https://')) {
      url = url || t;
    }
  }

  if (!url) {
    throw new Error('No se encontró URL en el comando cURL.');
  }

  if (!method) {
    if (dataParts.length > 0 && !getFlag) {
      method = 'POST';
    } else {
      method = 'GET';
    }
  }

  if (getFlag) {
    method = 'GET';
  }

  const urlObj = new URL(url);
  const query = [];
  urlObj.searchParams.forEach((value, key) => {
    query.push({ id: id(), key, value, enabled: true });
  });
  urlObj.search = '';

  if (getFlag && dataParts.length > 0) {
    dataParts.forEach((part) => {
      if (!part || part.startsWith('@')) return;
      const params = new URLSearchParams(part);
      for (const [k, v] of params.entries()) {
        query.push({ id: id(), key: k, value: v, enabled: true });
      }
    });
  }

  const bodyText = getFlag ? '' : dataParts.join('&');
  return {
    method,
    url: urlObj.toString(),
    headers,
    query,
    bodyText
  };
}

function escapeShell(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildCurl(req) {
  const url = buildUrl(req);
  const headers = buildHeaders(req);
  const bodyText =
    req.method === 'GET' || req.method === 'HEAD' ? '' : applyEnv(req.body?.text || '');

  const parts = [];
  parts.push(`curl --location --request ${req.method} ${escapeShell(url)}`);

  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H ${escapeShell(`${key}: ${value}`)}`);
  }

  if (bodyText) {
    parts.push(`--data-raw ${escapeShell(bodyText)}`);
  }

  return parts.join(' \\\n  ');
}

function parseJsonPath(path) {
  const tokens = [];
  let p = String(path || '').trim();
  if (!p) return tokens;
  if (p.startsWith('$')) p = p.slice(1);
  if (p.startsWith('.')) p = p.slice(1);

  const readIdentifier = () => {
    let start = i;
    while (i < p.length && p[i] !== '.' && p[i] !== '[') i += 1;
    return p.slice(start, i);
  };

  const readBracketToken = () => {
    i += 1; // skip [
    while (i < p.length && p[i] === ' ') i += 1;
    if (p[i] === '"' || p[i] === "'") {
      const quote = p[i];
      i += 1;
      let value = '';
      while (i < p.length && p[i] !== quote) {
        if (p[i] === '\\' && i + 1 < p.length) {
          value += p[i + 1];
          i += 2;
        } else {
          value += p[i];
          i += 1;
        }
      }
      if (p[i] === quote) i += 1;
      while (i < p.length && p[i] !== ']') i += 1;
      if (p[i] === ']') i += 1;
      return value;
    }
    if (p[i] === '*') {
      i += 1;
      while (i < p.length && p[i] !== ']') i += 1;
      if (p[i] === ']') i += 1;
      return '*';
    }
    const start = i;
    while (i < p.length && p[i] !== ']') i += 1;
    const raw = p.slice(start, i).trim();
    if (p[i] === ']') i += 1;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw || '';
  };

  let i = 0;
  while (i < p.length) {
    if (p[i] === '.') {
      if (p[i + 1] === '.') {
        i += 2;
        let key = '*';
        if (p[i] === '[') {
          key = readBracketToken();
        } else if (p[i] === '*') {
          i += 1;
          key = '*';
        } else {
          key = readIdentifier() || '*';
        }
        tokens.push({ type: 'recursive', key });
        continue;
      }
      i += 1;
      continue;
    }

    if (p[i] === '[') {
      const token = readBracketToken();
      if (token !== '') tokens.push(token);
      continue;
    }

    const ident = readIdentifier();
    if (ident) tokens.push(ident === '*' ? '*' : ident);
  }

  return tokens;
}

function collectRecursive(node, key, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (key === '*') out.push(item);
      collectRecursive(item, key, out);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const [k, value] of Object.entries(node)) {
      if (key === '*' || k === key) out.push(value);
      collectRecursive(value, key, out);
    }
  }
}

function getJsonPath(obj, path) {
  if (!path) return undefined;
  const tokens = parseJsonPath(path);
  if (!tokens.length) return obj;

  let nodes = [obj];
  for (const token of tokens) {
    const next = [];
    for (const node of nodes) {
      if (token && typeof token === 'object' && token.type === 'recursive') {
        collectRecursive(node, token.key, next);
        continue;
      }
      if (token === '*') {
        if (Array.isArray(node)) {
          next.push(...node);
        } else if (node && typeof node === 'object') {
          next.push(...Object.values(node));
        }
        continue;
      }
      if (typeof token === 'number') {
        if (Array.isArray(node) && node[token] !== undefined) next.push(node[token]);
        continue;
      }
      if (node && typeof node === 'object' && token in node) {
        next.push(node[token]);
      }
    }
    nodes = next;
    if (nodes.length === 0) break;
  }

  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return nodes;
}

function applyExtractors(req, result) {
  const env = getActiveEnv();
  if (!env) return [];
  const extractors = req.extractors || [];
  if (!extractors.length) return [];

  let jsonCache;
  let jsonParsed = false;
  const updated = new Map();

  for (const ex of extractors) {
    if (!ex?.target) continue;
    let value;

    if (ex.type === 'header') {
      const key = (ex.source || '').toLowerCase();
      if (!key) continue;
      value = result.headers?.[key];
      if (Array.isArray(value)) value = value.join(', ');
    } else if (ex.type === 'json') {
      if (!jsonParsed) {
        jsonParsed = true;
        try {
          jsonCache = JSON.parse(result.body || '');
        } catch {
          jsonCache = null;
        }
      }
      if (!jsonCache) continue;
      value = getJsonPath(jsonCache, ex.source || '');
      if (value !== null && typeof value === 'object') {
        value = JSON.stringify(value);
      }
    }

    if (value === undefined) continue;
    if (value === null) value = '';

    const existing = env.vars.find((v) => v.key === ex.target);
    if (existing) {
      existing.value = String(value);
    } else {
      env.vars.push({ id: id(), key: ex.target, value: String(value), enabled: true });
    }
    updated.set(ex.target, String(value));
  }

  return Array.from(updated.entries()).map(([key, value]) => ({ key, value }));
}

function renderTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.onclick = () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('hidden', content.id !== `tab-${target}`);
      });
    };
  });
}

async function sendRequest() {
  const req = getActiveReq();
  if (!req) return;

  let url;
  try {
    url = buildUrl(req);
  } catch {
    setResponse('URL invalida', '', '', { label: 'Error', color: 'rgba(255, 122, 162, 0.2)', text: '#ff7aa2' });
    return;
  }

  const headers = buildHeaders(req);
  const bodyText = req.method === 'GET' || req.method === 'HEAD' ? '' : applyEnv(req.body?.text || '');
  const queryApplied = (req.query || [])
    .filter((item) => item.key)
    .map((item) => ({ key: applyEnv(item.key), value: applyEnv(item.value || '') }));
  const requestSnapshot = {
    id: req.id,
    name: req.name,
    method: req.method,
    url,
    headers,
    query: queryApplied,
    bodyText
  };

  setResponse('Enviando...', '', '');

  const result = await window.app.sendHttp({
    method: req.method,
    url,
    headers,
    bodyText,
    timeoutMs: state.settings.timeoutMs,
    maxSizeBytes: state.settings.maxSizeBytes
  });

  if (!result.ok) {
    setResponse(`Error: ${result.error}`, '', '', { label: 'Error', color: 'rgba(255, 122, 162, 0.2)', text: '#ff7aa2' });
    return;
  }

  const varsUpdated = applyExtractors(req, result);
  if (varsUpdated.length > 0) {
    renderVars();
    scheduleSave();
  }

  const env = getActiveEnv();
  if (env) {
    env.history = Array.isArray(env.history) ? env.history : [];
    env.history.unshift({
      id: id(),
      ts: Date.now(),
      requestId: req.id,
      name: req.name || 'Sin nombre',
      method: req.method,
      url,
      status: result.status,
      statusText: result.statusText,
      elapsedMs: result.elapsedMs,
      vars: varsUpdated,
      request: requestSnapshot,
      response: {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body
      }
    });
    env.history = env.history.slice(0, 25);
    renderHistory();
    scheduleSave();
  }

  const metaParts = [
    `Status ${result.status} ${result.statusText}`,
    `${result.elapsedMs} ms`,
    `${Math.round(result.sizeBytes / 1024)} kb`
  ];
  if (varsUpdated.length > 0) metaParts.push(`vars: ${varsUpdated.length}`);
  const meta = metaParts.join(' · ');
  const headersText = JSON.stringify(result.headers, null, 2);

  let bodyTextOut = result.body || '';
  try {
    if (result.headers['content-type']?.includes('application/json')) {
      bodyTextOut = JSON.stringify(JSON.parse(result.body), null, 2);
    }
  } catch {
    bodyTextOut = result.body || '';
  }

  setResponse(meta, headersText, bodyTextOut, {
    label: result.status,
    color: result.status >= 400 ? 'rgba(255, 122, 162, 0.2)' : 'rgba(86, 210, 255, 0.2)',
    text: result.status >= 400 ? '#ff7aa2' : 'var(--accent-2)'
  });
}

function wireActions() {
  const settingsModal = $('settings-modal');
  const curlModal = $('curl-modal');
  const closeCurlModalBtn = $('btn-close-curl-modal');
  const curlInput = $('curl-input');
  const curlNameInput = $('curl-request-name');
  const curlImportMode = $('curl-import-mode');
  const curlImportConfirm = $('btn-import-curl-confirm');
  const requestFilterInput = $('request-filter');
  const withButtonLoading = async (btn, fn) => {
    if (!btn) return fn();
    const prev = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  };
  if (requestFilterInput) {
    requestFilterInput.oninput = (e) => {
      requestFilter = e.target.value || '';
      renderRequests();
    };
  }

  if (closeCurlModalBtn && curlModal) {
    closeCurlModalBtn.onclick = () => hideEnvModal(curlModal);
    curlModal.onclick = (event) => {
      if (event.target === curlModal) hideEnvModal(curlModal);
    };
  }

  if (curlImportConfirm && curlInput && curlImportMode) {
    curlImportConfirm.onclick = () => {
      const command = curlInput.value.trim();
      if (!command) {
        window.alert('Pega un comando cURL.');
        return;
      }
      let parsed;
      try {
        parsed = parseCurlCommand(command);
      } catch (err) {
        window.alert(`No se pudo importar: ${err?.message || err}`);
        return;
      }

      const env = getActiveEnv();
      if (!env) return;
      let targetReq;
      if (curlImportMode.value === 'overwrite') {
        targetReq = getActiveReq();
      } else {
        targetReq = createDefaultRequest();
        targetReq.name = 'Importado cURL';
        env.requests.unshift(targetReq);
        env.activeRequestId = targetReq.id;
      }

      if (!targetReq) return;

      const customName = curlNameInput?.value?.trim();
      if (curlImportMode.value === 'new') {
        targetReq.name = customName || targetReq.name || 'Importado cURL';
      } else if (customName) {
        targetReq.name = customName;
      }

      targetReq.method = parsed.method;
      targetReq.url = parsed.url;
      targetReq.query = parsed.query;
      targetReq.headers = Object.entries(parsed.headers || {}).map(([key, value]) => ({
        id: id(),
        key,
        value,
        enabled: true
      }));
      const contentType = Object.entries(parsed.headers || {}).find(
        ([key]) => key.toLowerCase() === 'content-type'
      )?.[1];
      targetReq.body.type = contentType && contentType.includes('json') ? 'json' : 'text';
      targetReq.body.text = parsed.bodyText || '';

      hideEnvModal(curlModal);
      curlInput.value = '';
      if (curlNameInput) curlNameInput.value = '';
      render();
      scheduleSave();
    };
  }

  $('btn-new-req').onclick = () => {
    const env = getActiveEnv();
    if (!env) return;
    const req = createDefaultRequest();
    req.name = `Request ${env.requests.length + 1}`;
    req.url = '';
    req.body.text = '';
    req.headers = [];
    req.query = [];
    env.requests.unshift(req);
    env.activeRequestId = req.id;
    render();
    scheduleSave();
  };

  $('btn-new-env').onclick = () => {
    const env = createEnvironment(`Entorno ${state.environments.length + 1}`, '');
    state.environments.push(env);
    state.activeEnvironmentId = env.id;
    render();
    scheduleSave();
  };

  $('btn-add-var').onclick = () => {
    const env = getActiveEnv();
    if (!env) return;
    env.vars.push({ id: id(), key: '', value: '', enabled: true });
    renderVars();
    scheduleSave();
  };

  const addGlobalVarBtn = $('btn-add-global-var');
  if (addGlobalVarBtn) {
    addGlobalVarBtn.onclick = () => {
      state.globals = state.globals || [];
      state.globals.push({ id: id(), key: '', value: '', enabled: true });
      renderGlobalVars();
      scheduleSave();
    };
  }

  const deleteEnvBtn = $('btn-delete-env');
  if (deleteEnvBtn) {
    deleteEnvBtn.onclick = () => {
      if (state.environments.length <= 1) return;
      const env = getActiveEnv();
      if (!env) return;
      const ok = window.confirm(`Eliminar entorno "${env.name}"?`);
      if (!ok) return;
      state.environments = state.environments.filter((e) => e.id !== env.id);
      state.activeEnvironmentId = state.environments[0]?.id || null;
      render();
      scheduleSave();
    };
  }

  const duplicateEnvBtn = $('btn-duplicate-env');
  if (duplicateEnvBtn) {
    duplicateEnvBtn.onclick = () => {
      const env = getActiveEnv();
      if (!env) return;
      const cloned = cloneEnvironment(env);
      state.environments.push(cloned);
      state.activeEnvironmentId = cloned.id;
      render();
      scheduleSave();
    };
  }

  const exportEnvBtn = $('btn-export-env');
  if (exportEnvBtn) {
    exportEnvBtn.onclick = async () => {
      await withButtonLoading(exportEnvBtn, () => safeOpenExportModal('env'));
    };
  }

  const toggleVarsBtn = $('btn-toggle-vars');
  if (toggleVarsBtn) {
    toggleVarsBtn.onclick = () => {
      document.body.classList.toggle('vars-expanded');
      const expanded = document.body.classList.contains('vars-expanded');
      toggleVarsBtn.textContent = expanded ? 'Contraer variables' : 'Expandir variables';
    };
  }

  const importEnvBtn = $('btn-import-env');
  if (importEnvBtn) {
    importEnvBtn.onclick = async () => {
      await openImportModal();
    };
  }

  $('btn-send').onclick = sendRequest;

  const exportCurlBtn = $('btn-export-curl');
  if (exportCurlBtn) {
    exportCurlBtn.onclick = async () => {
      const req = getActiveReq();
      if (!req) return;
      let curlText;
      try {
        curlText = buildCurl(req);
      } catch (err) {
        window.alert(`No se pudo generar cURL: ${err?.message || err}`);
        return;
      }

      if (window.app?.openCurl) {
        await window.app.openCurl({
          name: req.name || 'Request',
          url: buildUrl(req),
          curl: curlText
        });
      }
    };
  }

  const importCurlBtn = $('btn-import-curl');
  if (importCurlBtn && curlModal) {
    importCurlBtn.onclick = () => {
      curlModal.classList.remove('hidden');
      curlModal.style.display = 'grid';
      curlModal.style.opacity = '1';
      curlModal.style.pointerEvents = 'auto';
      curlModal.style.zIndex = '9999';
      if (curlInput) curlInput.focus();
    };
  }

  $('btn-export').onclick = async () => {
    const btn = $('btn-export');
    await withButtonLoading(btn, () => safeOpenExportModal('all'));
  };

  $('btn-import').onclick = async () => {
    await openImportModal();
  };

  const clearHistoryBtn = $('btn-clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.onclick = () => {
      const env = getActiveEnv();
      if (!env) return;
      env.history = [];
      renderHistory();
      scheduleSave();
    };
  }

  $('btn-settings').onclick = () => settingsModal.classList.remove('hidden');
  $('btn-close-settings').onclick = () => settingsModal.classList.add('hidden');
  settingsModal.onclick = (event) => {
    if (event.target === settingsModal) settingsModal.classList.add('hidden');
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      settingsModal.classList.add('hidden');
      const envModal = $('env-modal');
      if (envModal) hideEnvModal(envModal);
      const curlModal = $('curl-modal');
      if (curlModal) hideEnvModal(curlModal);
    }
  });

  $('btn-save-settings').onclick = async () => {
    state.settings.proxyUrl = $('proxy').value || '';
    state.settings.timeoutMs = Number($('timeout').value || 15000);
    state.settings.maxSizeBytes = Number($('max-size').value || 5000000);
    state.settings.allowInsecureSSL = $('toggle-insecure').checked;
    settingsModal.classList.add('hidden');
    scheduleSave();

    if (window.app?.setProxy) {
      try {
        await window.app.setProxy(state.settings.proxyUrl);
      } catch {
        // Ignore proxy errors; keep settings local.
      }
    }
  };
}

function renderSettings() {
  const settings = state.settings || defaultSettings;
  $('proxy').value = settings.proxyUrl || '';
  $('timeout').value = settings.timeoutMs || 15000;
  $('max-size').value = settings.maxSizeBytes || 5000000;
  $('toggle-insecure').checked = !!settings.allowInsecureSSL;
}

function render() {
  state.settings = { ...defaultSettings, ...(state.settings || {}) };
  renderEnvSelect();
  renderEnvMeta();
  renderRequestSelect();
  renderRequests();
  renderVars();
  renderGlobalVars();
  renderRequestEditor();
  renderSettings();
  renderHistory();
}

async function init() {
  // Render immediately so UI isn't blocked by IPC.
  state = normalizeState(null);

  renderTabs();
  wireActions();
  render();

  if (!window.app) {
    setResponse('Error: preload no cargado (window.app undefined).', '', 'Revisa la consola (DevTools).', {
      label: 'Error',
      color: 'rgba(255, 122, 162, 0.2)',
      text: '#ff7aa2'
    });
    return;
  }

  try {
    const readPromise = window.app.readState();
    const stored = await Promise.race([
      readPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout leyendo estado')), 1200))
    ]);

    if (stored) {
      state = normalizeState(stored);
      render();
    }
  } catch (err) {
    setResponse('Error inicializando estado.', '', String(err), {
      label: 'Error',
      color: 'rgba(255, 122, 162, 0.2)',
      text: '#ff7aa2'
    });
  }

  if (state.settings?.proxyUrl) {
    try {
      await window.app.setProxy(state.settings.proxyUrl);
    } catch {
      // ignore
    }
  }
}

init();
