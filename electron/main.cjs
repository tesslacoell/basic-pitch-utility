const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const separator = require('./separator.cjs');

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
// The file is written synchronously BEFORE startDrag is called: the OS drag
// session reads the file lazily, so it must already exist on disk.
ipcMain.on('start-drag', (event, { fileName, base64Data }) => {
  try {
    const filePath = path.join(tempDir, fileName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    // Pass a real NativeImage for the drag icon (a bare path string is only
    // tolerated on macOS; a NativeImage works on every platform, and an
    // empty image means the drag would fail silently — fall back to no icon).
    const iconPath = path.join(__dirname, 'midi_icon.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    const dragItem = { file: filePath };
    if (icon && !icon.isEmpty()) {
      dragItem.icon = icon;
    }
    event.sender.startDrag(dragItem);
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

// --- HTDemucs stem separator -------------------------------------------
// The model is NOT bundled with the app. It is downloaded once (after
// the user agrees to its license in the UI) into userData/models and
// verified against a pinned SHA-256. Separation sessions live under the
// temp dir; only the newest session is kept.

function modelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

function sessionsRoot() {
  return path.join(tempDir, 'demucs-sessions');
}

function sendDemucsProgress(event, progress) {
  try {
    event.sender.send('demucs-progress', progress);
  } catch {
    // window gone mid-run; the work itself is unaffected
  }
}

ipcMain.handle('demucs-model-status', async () => {
  return separator.getModelStatus(modelsDir());
});

ipcMain.handle('demucs-download-model', async (event) => {
  await separator.downloadModel(modelsDir(), (p) => sendDemucsProgress(event, p));
  return separator.getModelStatus(modelsDir());
});

ipcMain.handle('demucs-separate', async (event, { wavBase64, wantStems }) => {
  const root = sessionsRoot();
  fs.mkdirSync(root, { recursive: true });
  // Reap older sessions — only the latest conversion's stems are kept.
  for (const entry of fs.readdirSync(root)) {
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
  const sessionId = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const sessionDir = path.join(root, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const inputPath = path.join(sessionDir, 'master.wav');
  fs.writeFileSync(inputPath, Buffer.from(wavBase64, 'base64'));

  const result = await separator.separate(
    modelsDir(),
    inputPath,
    sessionDir,
    Array.isArray(wantStems) ? wantStems : [],
    (p) => sendDemucsProgress(event, p)
  );
  fs.unlinkSync(inputPath);

  // Ship analysis samples as raw bytes (structured clone copies them).
  const analysis = {};
  for (const [stem, samples] of Object.entries(result.analysis)) {
    analysis[stem] = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  }
  return {
    sessionId,
    durationSeconds: result.durationSeconds,
    analysisSampleRate: result.analysisSampleRate,
    analysis,
    wavFiles: result.wavFiles,
  };
});

ipcMain.handle('demucs-read-stem-wav', async (_event, { sessionId, demucsStem }) => {
  const fileName = separator.DEMUCS_STEMS.includes(demucsStem) ? `${demucsStem}.wav` : null;
  if (!fileName || !/^s[a-z0-9]+$/.test(sessionId)) {
    throw new Error('Unknown separation session or stem.');
  }
  const filePath = path.join(sessionsRoot(), sessionId, fileName);
  const data = fs.readFileSync(filePath);
  return { base64Data: data.toString('base64') };
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
