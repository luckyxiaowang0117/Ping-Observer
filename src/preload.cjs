const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pingApp', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  refreshNow: () => ipcRenderer.invoke('refresh:now'),
  setAutoRefresh: enabled => ipcRenderer.invoke('settings:auto-refresh', enabled),
  setInterval: minutes => ipcRenderer.invoke('settings:interval', minutes),
  openSource: () => ipcRenderer.invoke('source:open'),
  showMainWindow: () => ipcRenderer.invoke('window:show-main'),
  toggleFloatingWindow: () => ipcRenderer.invoke('floating:toggle'),
  setFloatingVisible: visible => ipcRenderer.invoke('floating:set-visible', visible),
  openLink: url => ipcRenderer.invoke('link:open', url),
  beginWindowDrag: point => ipcRenderer.send('window:drag-begin', point),
  moveWindowDrag: point => ipcRenderer.send('window:drag-move', point),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  onState: callback => ipcRenderer.on('state:update', (_event, state) => callback(state))
});
