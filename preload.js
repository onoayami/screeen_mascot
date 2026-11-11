const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mascotAPI', {
  loadConfig() {
    return ipcRenderer.invoke('mascot:load-editable-config');
  },
  recoverConfig(strategy) {
    return ipcRenderer.invoke('mascot:recover-config', strategy);
  },
  reportDirtyState(dirty) {
    ipcRenderer.send('mascot:settings-dirty', Boolean(dirty));
  },
  resolveAsset(relativePath) {
    return ipcRenderer.invoke('mascot:resolve-asset', relativePath);
  },
  getAssetMetadata(relativePath) {
    return ipcRenderer.invoke('mascot:get-asset-metadata', relativePath);
  },
  discardImportedImage(relativePath, category) {
    return ipcRenderer.invoke('mascot:discard-imported-image', relativePath, category);
  },
  chooseImage(category) {
    return ipcRenderer.invoke('mascot:choose-image', category);
  },
  importImage(sourcePath, category) {
    return ipcRenderer.invoke('mascot:import-image', { sourcePath, category });
  },
  saveTransparentPng(arrayBuffer, category, originalName) {
    return ipcRenderer.invoke('mascot:save-transparent-png', {
      arrayBuffer,
      category,
      originalName,
    });
  },
  async getPathForFile(file) {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath
        ? await ipcRenderer.invoke('mascot:register-dropped-path', filePath)
        : '';
    } catch (_error) {
      return '';
    }
  },
  saveConfig(config, previewActionIndex = null) {
    return ipcRenderer.invoke('mascot:save-config', { config, previewActionIndex });
  },
});
