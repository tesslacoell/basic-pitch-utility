const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Chromium WebGL & GPU hardware acceleration switches
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-gpu-rasterization');

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

  const distIndex = path.join(__dirname, '../dist/index.html');

  // If explicit dev server URL provided, use it
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch(() => {
      if (fs.existsSync(distIndex)) mainWindow.loadFile(distIndex);
    });
  } else if (fs.existsSync(distIndex)) {
    // 100% Standalone Mode: Load local bundled assets directly with zero server needed
    mainWindow.loadFile(distIndex);
  } else {
    // If dist doesn't exist yet, probe if local dev server is running on port 3000
    const http = require('http');
    const req = http.get('http://localhost:3000', (res) => {
      if (res.statusCode === 200) {
        mainWindow.loadURL('http://localhost:3000');
      } else {
        showBuildPrompt(mainWindow);
      }
    });
    req.on('error', () => {
      showBuildPrompt(mainWindow);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showBuildPrompt(win) {
  win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        '<!doctype html><html><body style="background:#0a0a0a;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
          '<div style="max-width:480px;padding:32px;background:#171717;border:1px solid #262626;border-radius:16px;">' +
          '<h2 style="margin-top:0;color:#10b981;">Basic Pitch Desktop</h2>' +
          '<p style="color:#a3a3a3;font-size:14px;line-height:1.6;">Standalone build assets not found in <code>dist/</code>. Please run the build command in your terminal:</p>' +
          '<code style="display:block;background:#000;color:#34d399;padding:12px;border-radius:8px;font-size:13px;margin:16px 0;">npm run build</code>' +
          '<p style="color:#737373;font-size:12px;">Or run <code>npm run dev</code> to start the development server.</p>' +
          '</div></body></html>'
      )
  );
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
