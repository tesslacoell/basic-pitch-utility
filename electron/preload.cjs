const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  startDrag: ({ fileName, base64Data }) => {
    ipcRenderer.send('start-drag', { fileName, base64Data });
  },
  saveMidiFile: async ({ fileName, base64Data }) => {
    return await ipcRenderer.invoke('save-midi-file', { fileName, base64Data });
  },
  getAppVersion: () => {
    return '1.0.0';
  },
});
