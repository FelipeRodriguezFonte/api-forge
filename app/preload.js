const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  readState: () => ipcRenderer.invoke('state:read'),
  writeState: (state) => ipcRenderer.invoke('state:write', state),
  exportState: (state) => ipcRenderer.invoke('state:export', state),
  importState: () => ipcRenderer.invoke('state:import'),
  sendHttp: (req) => ipcRenderer.invoke('http:send', req),
  setProxy: (proxyUrl) => ipcRenderer.invoke('settings:setProxy', proxyUrl),
  openHistory: (entry) => ipcRenderer.invoke('history:open', entry),
  getHistory: (id) => ipcRenderer.invoke('history:get', id),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  saveText: (payload) => ipcRenderer.invoke('file:saveText', payload),
  openCurl: (payload) => ipcRenderer.invoke('curl:open', payload),
  getCurl: (id) => ipcRenderer.invoke('curl:get', id)
});
