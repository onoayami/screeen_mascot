const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mascotAPI', {
  setMousePassthrough(ignore) {
    ipcRenderer.send('mascot:set-mouse-passthrough', Boolean(ignore));
  },
  loadConfig() {
    return ipcRenderer.invoke('mascot:load-config');
  },
  resolveAsset(relativePath) {
    return ipcRenderer.invoke('mascot:resolve-asset', relativePath);
  },
  reportApplyResult(payload) {
    ipcRenderer.send('mascot:apply-result', payload);
  },
  reportDiagnostic(type) {
    ipcRenderer.send('mascot:diagnostic', type);
  },
  onCommand(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('mascot:command', listener);
    return () => ipcRenderer.removeListener('mascot:command', listener);
  },
});
