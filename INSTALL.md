# Basic Pitch Audio-to-MIDI & Stem Extractor
# Standalone Desktop & Web Application Build Guide

This guide details all prerequisites, system interpreters, dependencies, configuration files, and exact terminal commands required to run and build the application as a **Standalone Desktop Application** (macOS, Windows, Linux) or as a **Web Application**.

---

## 1. System Requirements & Language Interpreters

| Requirement | Supported Versions | Notes |
| :--- | :--- | :--- |
| **Node.js Runtime** | `>= 18.0.0` (v20+ or v22 LTS recommended) | JavaScript / TypeScript execution engine |
| **Package Manager** | `npm >= 9.0.0` (or `pnpm`, `yarn`) | Dependency resolution and package scripts |
| **Operating System** | macOS (Intel & Apple Silicon), Windows 10/11, Linux (Ubuntu, Debian, Fedora, Arch) | Native desktop packages supported on all three |
| **Compiler / Toolchain** | Standard C++ / OS toolchain for Electron builds: <br>• **macOS**: Xcode Command Line Tools (`xcode-select --install`)<br>• **Windows**: Standard Visual C++ Redistributable or Build Tools<br>• **Linux**: `build-essential`, `libasound2`, `libnss3` | Required only when compiling binary Electron installers |

---

## 2. Complete Dependencies Inventory

The project dependencies defined in `package.json` cover three categories:

### A. Machine Learning & Audio Engine (Runtime)
- **`@spotify/basic-pitch`** (`^1.0.1`): Spotify's polyphonic pitch detection neural network. Converts audio frames into note onsets, velocities, and pitch bend contours.
- **`@tensorflow/tfjs`** (`^4.22.0`): TensorFlow.js graph model execution engine running inference in WebAssembly/WebGL.
- **`@tonejs/midi`** (`^2.0.28`): Standard MIDI binary encoder. Creates single-track and multi-track `.mid` files with customizable instruments, channels, and pitch bends.
- **`jszip`** (`^3.10.2`): In-memory ZIP archive generation for bundling all extracted stem MIDI files into a single `.zip` download.

### B. User Interface & Frontend (Runtime)
- **`react`** & **`react-dom`** (`^19.0.1`): Declarative UI components and reactive state.
- **`tailwindcss`** & **`@tailwindcss/vite`** (`^4.3.3`): Utility-first styling engine.
- **`lucide-react`** (`^0.546.0`): Icon system (instruments, drag handles, waveforms).
- **`motion`** (`^12.23.24`): Fluid UI transitions.

### C. Desktop Packaging & Build Tooling (DevDependencies)
- **`electron`** (`^45.3.0`): Native desktop application framework (Chromium + Node.js runtime).
- **`electron-builder`** (`^26.18.0`): Multi-platform desktop packaging engine. Produces `.dmg`, `.exe`, and `.AppImage` installers.
- **`vite`** (`^8.3.0`): High-speed bundler and development server.
- **`@vitejs/plugin-react`** (`^6.1.1`): Vite React plugin.
- **`typescript`** (`^7.0.2`): Strict static typing across the engine.
- **`tsx`** (`^4.21.0`): TypeScript execution environment for Node.js scripts.
- **`esbuild`** (`^0.25.0`): High-speed JavaScript compiler.

---

## 3. Directory & File Structure Reference

```
/
├── build.sh                # macOS & Linux one-click automated setup & build script
├── build.bat               # Windows one-click automated setup & build script
├── scripts/
│   └── build.mjs           # Cross-platform automated build engine (Node.js)
├── electron/
│   ├── main.cjs            # Electron main process (window, native startDrag, save dialog)
│   ├── preload.cjs         # Context-isolated secure bridge (window.electronAPI)
│   └── midi_icon.png       # Native OS drag cursor icon
├── public/
│   ├── model/
│   │   ├── model.json          # Pre-trained Spotify Basic Pitch model manifest
│   │   └── group1-shard1of1.bin # Neural network weight shard (742 KB)
│   └── samples/
│       ├── band_song_mix.wav   # Full band audio sample (Piano + Guitar + Bass)
│       ├── guitar_arpeggio.wav # Acoustic guitar sample
│       └── piano_melody.wav    # Jazz piano sample
├── src/
│   ├── components/
│   │   └── PianoRoll.tsx       # Multi-stem canvas visualizer
│   ├── services/
│   │   ├── basicPitchService.ts   # Inference, MIDI builder, multi-timbral synth
│   │   └── stemSeparationService.ts # DSP spectral band filters (Piano, Guitar, Bass, Lead)
│   ├── types/
│   │   └── electron.d.ts       # Window.electronAPI TypeScript types
│   ├── App.tsx                 # Main application UI & drag/drop handling
│   ├── index.css               # Global Tailwind CSS configuration
│   └── main.tsx                # React DOM root entry point
├── INSTALL.md                  # This build & installation guide
├── README.md                   # Project overview & architectural documentation
├── index.html                  # HTML entry point with Plus Jakarta Sans & JetBrains Mono
├── package.json                # Scripts, dependencies, and electron-builder configuration
├── tsconfig.json               # TypeScript compiler options
└── vite.config.ts              # Vite plugins and path aliases
```

---

## 4. One-Click Automated Build & Setup (Recommended)

The project includes an **automatic OS-detecting build script** that automatically:
1. Detects your operating system (**macOS** Apple Silicon / Intel, **Windows**, or **Linux**)
2. Verifies your Node.js runtime environment (>= 18.0.0)
3. Automatically fetches and installs all required dependencies
4. Verifies and restores local neural network model weights
5. Builds the production toolkit and compiles all DSP audio filters
6. Builds the standalone desktop installer for your platform (or launches the app immediately)

### Run the Automated Script for Your Platform:

#### macOS & Linux:
```bash
./build.sh
```
*(To build and immediately launch the standalone desktop window):*
```bash
./build.sh --run
```

#### Windows (Command Prompt or PowerShell):
```cmd
build.bat
```
*(To build and immediately launch):*
```cmd
build.bat --run
```

#### Cross-Platform / Node.js Direct:
```bash
npm run toolkit:build
# or to build and launch immediately:
npm run toolkit:run
```

### Clean Option (Removing Build Artifacts):
To clean previous build files (`dist/`, `release/`, and `.vite` build cache):
- **macOS & Linux**:
  ```bash
  ./build.sh clean
  ```
- **Windows**:
  ```cmd
  build.bat clean
  ```
- **npm**:
  ```bash
  npm run clean
  ```

You can also combine clean with a fresh build or run in a single command:
```bash
# Clean first, then build and launch standalone window:
./build.sh clean --run
# Or on Windows:
build.bat clean --run
```

### Available Script Commands & Flags:
- `clean` (or `--clean`): Wipes `dist/`, `release/`, and cache folders. If passed alone, cleans and exits immediately.
- `--run`: Compiles and immediately launches the standalone desktop application window.
- `--package`: Packages standalone native installers (`.dmg`, `.exe`, `.AppImage`) into `release/` (default behavior).
- `--web`: Compiles only the web distribution into `dist/`.

---

## 5. Manual Step-by-Step Installation (Alternative)

If you prefer to run each step manually instead of using the automated script:

### Step 1: Open Terminal in Project Root
```bash
cd /path/to/project
```

### Step 2: Install All Dependencies
```bash
npm install
```

### Step 3: Verify Pre-trained Model Weights
The neural network model weights are bundled directly inside `public/model/`:
- `public/model/model.json`
- `public/model/group1-shard1of1.bin`

They are served locally with zero external network or CDN latency. If you ever need to restore them from the npm package, run:
```bash
mkdir -p public/model
cp node_modules/@spotify/basic-pitch/model/* public/model/
```

---

## 6. Standalone Desktop Application (macOS, Windows, Linux)

Running as a standalone desktop application provides the highest performance and true OS-level drag-and-drop straight into Digital Audio Workstations.

### Why Standalone is Recommended for DAWs:
In a web browser, dragging a generated file outside the window is limited by browser security sandboxes. In the standalone Electron app, the engine calls the operating system's native C++ drag API (`event.sender.startDrag()`). When you drag a stem or master MIDI card, **Ableton Live**, **Logic Pro**, **FL Studio**, **Studio One**, **Reaper**, and **GarageBand** recognize it immediately as an actual `.mid` file on your filesystem.

### A. Run Standalone Desktop App (Instant Launch / Dev Mode)
```bash
npm run electron:dev
```
This command builds the frontend assets and launches the native Electron desktop window.

### B. Package Standalone Distributables (Installers)
To build standalone distributable binaries for your current operating system:
```bash
npm run electron:build
```

To target a specific operating system:
- **macOS (DMG & ZIP)**:
  ```bash
  npx electron-builder --mac
  ```
  *Outputs:* `release/Basic Pitch MIDI-[version].dmg` and `.zip`
- **Windows (NSIS Installer & Portable EXE)**:
  ```bash
  npx electron-builder --win
  ```
  *Outputs:* `release/Basic Pitch MIDI Setup [version].exe` and portable `.exe`
- **Linux (AppImage & DEB package)**:
  ```bash
  npx electron-builder --linux
  ```
  *Outputs:* `release/Basic Pitch MIDI-[version].AppImage` and `.deb`

The generated installers will be in the `release/` directory.

---

## 7. Starting the Standalone Server (Browser Mode)

If you wish to run the app as a web server accessible via web browser:

### A. Start the Standalone Development Server:
```bash
npm run dev
# or:
npm run server
```
This command starts the local standalone server at:
```
http://localhost:3000
```
Open `http://localhost:3000` in any web browser.

### B. Start the Production Preview Server:
To run the server against compiled, minified production assets:
```bash
npm run build
npm run preview
```
This serves the standalone production build from `dist/` at `http://localhost:4173`.

---

## 8. Package Scripts Quick Reference

| Command | Action |
| :--- | :--- |
| `npm run toolkit:run` | **Runs the automated build script and immediately launches the standalone desktop app** |
| `npm run toolkit:build` | **Runs the automated build script to detect OS, install dependencies & package installers** |
| `./build.sh` | **macOS & Linux one-click automated setup & build script** |
| `build.bat` | **Windows one-click automated setup & build script** |
| `npm run electron` | **Builds frontend and opens standalone desktop window directly (offline, no server needed)** |
| `npm run server` / `npm run dev` | **Starts the standalone web server on `http://localhost:3000`** |
| `npm run preview` | Starts the production preview server on `http://localhost:4173` |
| `npm run electron:build` | Packages native desktop installers (`.dmg`, `.exe`, `.AppImage`) into `release/` |
| `npm run build` | Compiles production web assets into the `dist/` directory |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run clean` | Deletes `dist/` and `release/` build output folders |

---

## 9. Workflow & Feature Reference

1. **Audio Ingestion**:
   - Drag and drop any audio file (`.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aiff`) onto the dropzone.
   - Or click "Choose audio file", use the sample buttons (`Full Band Mix`, `Guitar Arpeggio`, `Piano Melody`), or click "Record Mic" to hum a melody.
2. **Stem Selection**:
   - Choose which stems to extract: **Piano & Keyboards**, **Guitars**, **Bass**, and **Lead & Vocals**.
3. **Multi-Stage Conversion**:
   - Real-time progress bar tracking audio decoding, 22.05 kHz resampling, DSP frequency filtering, and neural polyphonic pitch transcription.
4. **Drag-and-Drop Out**:
   - **Combined Master MIDI**: Drag the master `.mid` token into your DAW or desktop. Contains all stems on separate channels (Ch 1: Piano, Ch 2: Guitars, Ch 3: Bass, Ch 4: Lead).
   - **Individual Stems**: Drag any individual stem card (`_piano.mid`, `_guitar.mid`, `_bass.mid`, `_lead.mid`) directly into individual DAW audio/instrument tracks.
   - **Download All (.ZIP)**: One-click bundle with all stem files and master MIDI.
5. **Multi-Track Audition & Piano Roll**:
   - Built-in multi-timbral polyphonic synthesizer to audition stems together or solo/mute individual instruments.
   - Interactive color-coded piano roll with stem filtering.

---

## 10. Troubleshooting & Platform-Specific Notes

### Electron `ERR_CONNECTION_REFUSED` (Failed to load URL: http://localhost:3000/)
If you encounter this error when running Electron:
- **Cause**: Electron was attempting to connect to a dev server on port 3000 that was not currently running in another terminal.
- **Solution 1 (Recommended - 100% Offline Standalone Desktop)**:
  Electron is now configured to load the compiled `dist/index.html` directly offline without needing any web server running at all!
  Simply run:
  ```bash
  npm run electron
  # or:
  ./build.sh --run
  ```
  This builds `dist/` if needed and opens the standalone desktop window directly.
- **Solution 2 (Web Server Mode)**:
  If you want to run the web server on `http://localhost:3000`:
  ```bash
  npm run server
  # or:
  npm run dev
  ```

### Dependency Resolution (`ERESOLVE could not resolve`)
If running a manual `npm install` on an older or strict npm environment triggers an `ERESOLVE` conflict:
- The conflicting `esbuild: "^0.25.0"` entry has been removed from `package.json` so that `vite@8` resolves its own required `esbuild` peer dependency cleanly.
- If your environment's npm cache has cached older peers, simply run:
  ```bash
  npm install --legacy-peer-deps
  ```
- Or run `./build.sh` (or `build.bat`), which handles this resolution check and fallback automatically.

### macOS Window Dragging & Titlebar Management
- **Native Window Drag Region**: The application header uses `-webkit-app-region: drag` so you can click and drag the window anywhere by its top header bar on macOS.
- **Traffic Light Clearance**: When running inside Electron with `hiddenInset` titlebar on macOS, the header automatically offsets with `pl-20` (80px padding) so the brand logo never collides with native macOS traffic light window controls (close, minimize, zoom).
- **Interactive Buttons**: All interactive header buttons and modal triggers use `-webkit-app-region: no-drag` to ensure full clickability and responsiveness.

### WebGL Fragment Shader Error ("Failed to compile fragment shader")
- **Cause**: On certain macOS hardware (especially Apple Silicon / ANGLE / Metal shader translators in Chromium), TensorFlow.js WebGL backend may hit driver-level shader compilation errors when executing packed convolution layers.
- **Automatic Fallback Solution**:
  1. The app sets proactive WebGL safety flags (`WEBGL_PACK: false`, `WEBGL_RENDER_FLOAT32_CAPABLE: false`, `WEBGL_FORCE_F16_TEXTURES: false`).
  2. If any shader compilation failure is detected during audio transcription, the engine **automatically catches the error and seamlessly falls back to the TensorFlow.js CPU backend**, re-running inference transparently without crashing or failing your audio processing.
  3. Chromium GPU acceleration flags (`--ignore-gpu-blocklist`, `--enable-webgl`) have been enabled in `electron/main.cjs`.

### macOS
- **Gatekeeper Warning on Unpackaged Builds**: When running locally generated unsigned `.dmg` or `.app` bundles, macOS Gatekeeper may show a warning: *"App cannot be opened because Apple cannot check it for malicious software"*.
  - To open: Right-click (or Control-click) the application in Finder and select **Open**.
  - Or in Terminal:
    ```bash
    xattr -cr /path/to/"Basic Pitch MIDI.app"
    ```
- **Permission for Microphone**: If using the microphone recording option, macOS will prompt for audio capture permission on first use.

### Windows
- **PowerShell Script Execution Policy**: If PowerShell blocks running `build.bat` or npm scripts with an `ExecutionPolicy` error:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  ```
- **Antivirus False Positives**: Some third-party antivirus suites flag newly packaged, self-compiled Electron executables. Add `release/` to your folder exclusions if needed.

### Linux
- **AppImage Execution Permissions**: If double-clicking the `.AppImage` does not launch it:
  ```bash
  chmod +x release/*.AppImage
  ./release/*.AppImage
  ```
- **FUSE Dependency**: If running `.AppImage` on Ubuntu 22.04+ or Debian 12 without `libfuse2`:
  ```bash
  sudo apt install libfuse2
  ```
  *(Or run with `--no-sandbox` if running in an automated Docker container)*.
- **Audio Subsystem**: Ensure ALSA / PulseAudio or PipeWire is running for Web Audio playback.
