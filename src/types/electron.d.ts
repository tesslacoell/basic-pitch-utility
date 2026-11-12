export interface ElectronAPI {
  isElectron: boolean;
  startDrag: (args: { fileName: string; base64Data: string }) => void;
  saveMidiFile: (args: { fileName: string; base64Data: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  getAppVersion: () => string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
