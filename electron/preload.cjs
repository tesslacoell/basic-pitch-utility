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
  demucsModelStatus: async () => {
    return await ipcRenderer.invoke('demucs-model-status');
  },
  demucsDownloadModel: async () => {
    return await ipcRenderer.invoke('demucs-download-model');
  },
  demucsSeparate: async ({ wavBase64, wantStems }) => {
    return await ipcRenderer.invoke('demucs-separate', { wavBase64, wantStems });
  },
  demucsReadStemWav: async ({ sessionId, demucsStem }) => {
    return await ipcRenderer.invoke('demucs-read-stem-wav', { sessionId, demucsStem });
  },
  onDemucsProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('demucs-progress', listener);
    return () => ipcRenderer.removeListener('demucs-progress', listener);
  },
});
