# Basic Pitch MIDI — macOS first-launch guide

This app is free and open source, but it is **not notarized by Apple**
(notarization requires a paid Apple Developer account). macOS therefore
blocks the first launch with a warning. This is expected — you only have
to approve the app once, and after that it opens normally.

## Install

1. Download the `.dmg` from the release page and open it.
2. Drag **Basic Pitch MIDI** into the **Applications** folder.
3. Eject the disk image.

## First launch (macOS Sequoia / Sonoma)

1. Open **Applications** and double-click **Basic Pitch MIDI**.
2. A dialog will say Apple could not verify the app is free of malware
   (older macOS: "…cannot be opened because the developer cannot be
   verified"). Click **Done** — do **not** click "Move to Trash".
3. Open **System Settings → Privacy & Security**.
4. Scroll down to the **Security** section. You'll see a line saying
   "Basic Pitch MIDI" was blocked to protect your Mac. Click
   **Open Anyway**.
5. Confirm with **Open Anyway** again (Touch ID / password if asked).
6. The app launches. From now on it opens with a normal double-click.

On macOS Ventura and earlier, you can instead right-click (Control-click)
the app in Applications → **Open** → **Open**.

## If it still won't open

Open **Terminal** (Applications → Utilities) and run:

```
xattr -dr com.apple.quarantine "/Applications/Basic Pitch MIDI.app"
```

Then launch the app normally. This removes the "downloaded from the
internet" flag your browser put on the file — nothing else.

## Why the warning?

Gatekeeper trusts apps that are signed with a paid Apple Developer
certificate and notarized by Apple. This utility is a free community
tool built without one, so macOS asks you to approve it manually —
the steps above. The full source code is public in this repository,
and the app runs entirely on your machine: no account, no uploads,
your audio never leaves your computer.
