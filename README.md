# Basic Pitch Audio-to-MIDI & Stem Extractor
### Standalone Desktop Toolkit & Polyphonic Music Transcriber

An audio-to-MIDI converter and instrument stem extractor powered by **Spotify's Basic Pitch** neural network. Built with a focus on simplicity: drag and drop an audio file into the window, and drag individual stem MIDI files or a master multi-track MIDI file directly into your Digital Audio Workstation (**Ableton Live**, **Logic Pro**, **FL Studio**, **Studio One**, **Reaper**, **GarageBand**) or onto your desktop.

---

## Key Features

- **Direct Drag & Drop Workflow**:
  - **Drag In**: Accepts MP3, WAV, FLAC, OGG, M4A, and AIFF audio files.
  - **Drag Out**: Native OS file drag-out allows dropping generated `.mid` files directly onto DAW instrument tracks and desktop folders.
- **Polyphonic Multi-Stem Extraction**:
  - 🎹 **Piano & Keyboards**: Chords, electric keys, organs, and harmonic mid-range.
  - 🎸 **Guitars**: Acoustic/electric strums, picking, and guitar body resonance.
  - 🎸 **Bass**: Low-end fundamental basslines, electric bass, and synth bass (30 Hz – 280 Hz).
  - 🎤 **Lead & Vocals**: Melodic top-lines, vocal contours, and pitch bends.
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
```

### Windows (Command Prompt / PowerShell):
```cmd
# Package standalone desktop installers (.exe):
build.bat

# Or build and launch immediately:
build.bat --run
```

### Cross-Platform via npm:
```bash
# Package installers for your current OS:
npm run toolkit:build

# Launch standalone desktop window immediately:
npm run toolkit:run
```

---

## Quick Reference Scripts

| Command | Description |
| :--- | :--- |
| `./build.sh` | Automated macOS/Linux setup, dependency check & native installer build |
| `build.bat` | Automated Windows setup, dependency check & installer build |
| `npm run toolkit:run` | Builds and immediately launches the native standalone desktop app |
| `npm run electron:dev` | Starts the standalone Electron desktop window directly |
| `npm run electron:build` | Packages native installers (`.dmg`, `.exe`, `.AppImage`) into `release/` |
| `npm run dev` | Starts the local web development server on `http://localhost:3000` |
| `npm run build` | Compiles static web distribution into `dist/` |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |

---

## Detailed Build & Installation Guide

For in-depth documentation covering system requirements, language interpreters, manual installation steps, Docker containerization, and troubleshooting, see [INSTALL.md](INSTALL.md).
