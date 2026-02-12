const { app, BrowserWindow, ipcMain, dialog, net, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const STATE_FILE = path.join(app.getPath('userData'), 'state.json');

function readStateSync() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const preState = readStateSync();
if (preState?.settings?.allowInsecureSSL) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

let mainWindow;
const historyStore = new Map();
const curlStore = new Map();

function createHistoryWindow(id) {
  const historyWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#0b0f1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  historyWindow.on('closed', () => {
    historyStore.delete(id);
  });

  historyWindow.loadFile(path.join(__dirname, 'history.html'), {
    query: { id }
  });
}

function createCurlWindow(id) {
  const curlWindow = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 700,
    minHeight: 480,
    backgroundColor: '#0b0f1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  curlWindow.on('closed', () => {
    curlStore.delete(id);
  });

  curlWindow.loadFile(path.join(__dirname, 'curl.html'), {
    query: { id }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    backgroundColor: '#0b0f1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(state) {
  const dir = path.dirname(STATE_FILE);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

ipcMain.handle('state:read', async () => {
  return readState();
});

ipcMain.handle('state:write', async (_event, state) => {
  await writeState(state);
  return true;
});

ipcMain.handle('state:export', async (_event, payload) => {
  const data = payload?.data ?? payload;
  const defaultName = payload?.defaultName || 'api-forge.json';
  const result = await dialog.showSaveDialog({
    title: 'Exportar configuracion',
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  await fsp.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('state:import', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Importar configuracion',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false };
  const raw = await fsp.readFile(result.filePaths[0], 'utf8');
  return { ok: true, data: JSON.parse(raw), path: result.filePaths[0] };
});

ipcMain.handle('settings:setProxy', async (_event, proxyUrl) => {
  const rules = proxyUrl?.trim() ? proxyUrl.trim() : 'direct://';
  await session.defaultSession.setProxy({ proxyRules: rules });
  return true;
});

ipcMain.handle('history:open', async (_event, entry) => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  historyStore.set(id, entry);
  createHistoryWindow(id);
  return { ok: true, id };
});

ipcMain.handle('history:get', async (_event, id) => {
  return historyStore.get(id) || null;
});

ipcMain.handle('curl:open', async (_event, payload) => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  curlStore.set(id, payload);
  createCurlWindow(id);
  return { ok: true, id };
});

ipcMain.handle('curl:get', async (_event, id) => {
  return curlStore.get(id) || null;
});

ipcMain.handle('clipboard:write', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('file:saveText', async (_event, payload) => {
  const text = payload?.text ?? '';
  const defaultName = payload?.defaultName || 'export.txt';
  const result = await dialog.showSaveDialog({
    title: 'Guardar archivo',
    defaultPath: defaultName,
    filters: [{ name: 'Archivos', extensions: ['txt', 'sh', 'curl'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false };
  await fsp.writeFile(result.filePath, String(text), 'utf8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('http:send', async (_event, req) => {
  const { method, url, headers, bodyText, timeoutMs, maxSizeBytes } = req;
  const start = Date.now();

  return new Promise((resolve) => {
    const request = net.request({
      method,
      url,
      redirect: 'follow'
    });

    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null && String(value).length > 0) {
          request.setHeader(key, String(value));
        }
      }
    }

    const timer = setTimeout(() => {
      request.abort();
      resolve({
        ok: false,
        error: 'Timeout',
        elapsedMs: Date.now() - start
      });
    }, Math.max(1000, timeoutMs || 15000));

    request.on('response', (response) => {
      const chunks = [];
      let size = 0;
      const limit = Math.max(1024 * 1024, maxSizeBytes || 5 * 1024 * 1024);

      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          request.abort();
          clearTimeout(timer);
          resolve({
            ok: false,
            error: 'Response too large',
            elapsedMs: Date.now() - start
          });
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: true,
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: response.headers,
          body,
          elapsedMs: Date.now() - start,
          sizeBytes: size
        });
      });
    });

    request.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: err.message,
        elapsedMs: Date.now() - start
      });
    });

    if (bodyText && String(bodyText).length > 0) {
      request.write(String(bodyText));
    }

    request.end();
  });
});
