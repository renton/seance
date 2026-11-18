// Everything the page can ask the main process for. There is no way from the page to run
// anything else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seance', {
  list: () => ipcRenderer.invoke('seance:list'),
  open: (sessionId) => ipcRenderer.invoke('seance:open', sessionId),
  create: (request) => ipcRenderer.invoke('seance:create', request),
  openLink: (url) => ipcRenderer.invoke('seance:link', url),
});
