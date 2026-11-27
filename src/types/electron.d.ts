export interface DemucsProgress {
  phase: 'download' | 'separate';
  receivedBytes?: number;
  totalBytes?: number;
  chunk?: number;
  chunks?: number;
}

export interface DemucsModelStatus {
  state: 'ready' | 'missing';
  version: string;
  sizeBytes?: number;
}

export interface DemucsSeparateResult {
  sessionId: string;
  durationSeconds: number;
  analysisSampleRate: number;
  /** App stem -> 22.05 kHz mono analysis samples (transferred bytes). */
  analysis: Record<string, Uint8Array>;
  /** Demucs stem name -> WAV file name inside the session folder. */
  wavFiles: Record<string, string>;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform?: string;
  startDrag: (args: { fileName: string; base64Data: string }) => void;
  saveMidiFile: (args: { fileName: string; base64Data: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  getAppVersion: () => string;
  demucsModelStatus: () => Promise<DemucsModelStatus>;
  demucsDownloadModel: () => Promise<DemucsModelStatus>;
  demucsSeparate: (args: { wavBase64: string; wantStems: string[] }) => Promise<DemucsSeparateResult>;
  demucsReadStemWav: (args: { sessionId: string; demucsStem: string }) => Promise<{ base64Data: string }>;
  onDemucsProgress: (callback: (progress: DemucsProgress) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
