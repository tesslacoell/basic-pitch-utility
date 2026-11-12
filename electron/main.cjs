const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Directory for temporary dragged MIDI files
const tempDir = path.join(os.tmpdir(), 'basic-pitch-midi-stems');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 880,
    minWidth: 800,
    minHeight: 650,
    backgroundColor: '#0a0a0a',
    title: 'Basic Pitch — Audio to MIDI & Stem Extractor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devServerUrl).catch(() => {
      // If dev server not yet up, fallback to loading dist
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Native OS drag-and-drop out to Desktop / DAW (Ableton, Logic, FL Studio, etc.)
ipcMain.on('start-drag', (event, { fileName, base64Data }) => {
  try {
    const filePath = path.join(tempDir, fileName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const iconPath = path.join(__dirname, 'midi_icon.png');
    event.sender.startDrag({
      file: filePath,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
    });
  } catch (err) {
    console.error('Error in native startDrag:', err);
  }
});

// Native OS Save Dialog
ipcMain.handle('save-midi-file', async (event, { fileName, base64Data }) => {
  if (!mainWindow) return { canceled: true };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save MIDI File',
    defaultPath: fileName,
    filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }],
  });

  if (!canceled && filePath) {
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { canceled: false, filePath };
  }
  return { canceled: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
