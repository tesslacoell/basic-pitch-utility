# Basic Pitch Audio-to-MIDI & Stem Extractor
### Standalone Desktop Toolkit & Polyphonic Music Transcriber

An audio-to-MIDI converter and instrument stem extractor powered by **Spotify's Basic Pitch** neural network. Built with a focus on simplicity: drag and drop an audio file into the window, and drag individual stem MIDI files or a master multi-track MIDI file directly into your Digital Audio Workstation (**Ableton Live**, **Logic Pro**, **FL Studio**, **Studio One**, **Reaper**, **GarageBand**) or onto your desktop.

---

## Key Features

- **Direct Drag & Drop Workflow**:
  - **Drag In**: Accepts MP3, WAV, FLAC, OGG, M4A, and AIFF audio files.
  - **Drag Out**: Native OS file drag-out allows dropping generated `.mid` files directly onto DAW instrument tracks and desktop folders.
- **Real Stem Separation (HTDemucs 6s)**:
  - Each track is separated by Meta's HTDemucs 6-stem model before anything is transcribed — the Piano, Guitar, Bass, Lead and Drums MIDI is transcribed from that instrument's own separated stem, never from a filtered copy of the mix.
  - 🎹 **Piano & Keyboards**: Chords, electric keys, organs, and harmonic mid-range.
  - 🎸 **Guitars**: Acoustic/electric strums, picking, and guitar body resonance.
  - 🎸 **Bass**: Low-end fundamental basslines, electric bass, and synth bass.
  - 🎤 **Lead & Vocals**: Melodic top-lines, vocal contours, and pitch bends.
  - 🥁 **Drums**: Kick, snare, hats and toms transcribed from the separated drums stem.
  - **Separated audio out, too**: every separated stem can be downloaded or dragged out as a 24-bit WAV, individually or as an **Audio Stems (.ZIP)**.
  - The model (~258 MB, MIT license) is **not bundled** with the app. The first time you separate, the app shows the license and, with your agreement, downloads the model once and verifies it against a pinned checksum; it re-downloads only when the model version changes.
- **Combined Master Multi-Track MIDI**:
  - Automatically exports all extracted stems arranged onto separate MIDI channels (Ch 1: Piano, Ch 2: Guitars, Ch 3: Bass, Ch 4: Lead) in a single master `.mid` file.
- **Built-in Audition & Visualizer**:
  - Multi-timbral polyphonic synthesizer to audition stems together or solo/mute individual instruments.
  - Interactive color-coded piano roll showing note timing, pitch bounds, and playback scrubber.
- **Standalone Desktop Execution**:
  - Native desktop window with zero browser tab clutter and true OS-level drag-and-drop.
  - Pre-configured with **Electron** and **electron-builder** for macOS, Windows, and Linux.

---

## One-Click Setup & Build

The repository includes an automatic cross-platform build script that detects your OS, checks prerequisites, installs dependencies, and packages the standalone application:

### macOS & Linux:
```bash
# Package standalone desktop installers (.dmg / .AppImage):
./build.sh

# Or build and launch the desktop window immediately:
./build.sh --run

# Clean build files (dist/ and release/):
./build.sh clean
```

### Windows (Command Prompt / PowerShell):
```cmd
# Package standalone desktop installers (.exe):
build.bat

# Or build and launch immediately:
build.bat --run

# Clean build files:
build.bat clean
```

### Cross-Platform via npm:
```bash
# Package installers for your current OS:
npm run toolkit:build

# Launch standalone desktop window immediately:
npm run toolkit:run

# Clean build artifacts:
npm run clean
```

---

## Quick Reference Scripts

| Command | Description |
| :--- | :--- |
| `./build.sh` | Automated macOS/Linux setup, dependency check & native installer build |
| `./build.sh --run` | Builds and immediately launches the standalone desktop app window |
| `./build.sh clean` | **Cleans previous `dist/` and `release/` build files** |
| `build.bat` | Automated Windows setup, dependency check & installer build |
| `build.bat --run` | Windows: Builds and immediately launches the standalone app |
| `build.bat clean` | **Cleans Windows build files** |
| `npm run electron` | **Runs standalone desktop app (offline, loads local files directly, no server needed)** |
| `npm run server` / `npm run dev` | **Starts the standalone web server on `http://localhost:3000`** |
| `npm run preview` | Starts the production preview server on `http://localhost:4173` |
| `npm run clean` | Removes `dist/`, `release/`, and build cache |
| `npm run electron:build` | Packages native installers (`.dmg`, `.exe`, `.AppImage`) into `release/` |
| `npm run build` | Compiles static web distribution into `dist/` |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |

---

## Detailed Build & Installation Guide

For in-depth documentation covering system requirements, language interpreters, manual installation steps, Docker containerization, and troubleshooting, see [INSTALL.md](INSTALL.md).
