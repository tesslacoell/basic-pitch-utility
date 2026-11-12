#!/usr/bin/env node

/**
 * Basic Pitch Audio-to-MIDI & Stem Extractor
 * Automated Cross-Platform Build & Packaging Script
 *
 * Automatically detects the operating system (macOS, Windows, Linux),
 * checks and installs dependencies, prepares model weights,
 * and builds the standalone desktop toolkit or web distribution.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// CLI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(msg) {
  console.log(`${colors.cyan}[Toolkit Build]${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}✔ ${msg}${colors.reset}`);
}

function warn(msg) {
  console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
}

function error(msg) {
  console.error(`${colors.red}✖ ${msg}${colors.reset}`);
}

function header(title) {
  console.log('\n' + colors.bright + colors.magenta + '━'.repeat(60) + colors.reset);
  console.log(colors.bright + `  ${title}` + colors.reset);
  console.log(colors.bright + colors.magenta + '━'.repeat(60) + colors.reset + '\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const isCleanCommand = args.includes('clean') || args.includes('--clean');
const shouldRun = args.includes('--run') || args.includes('run');
const onlyWeb = args.includes('--web') || args.includes('web');
const hasExplicitPackage = args.includes('--package') || args.includes('package');
const hasExplicitBuild = args.includes('--build') || args.includes('build');
const onlyClean = isCleanCommand && !shouldRun && !hasExplicitPackage && !hasExplicitBuild && !onlyWeb;
const shouldPackage = !onlyWeb && !onlyClean && (hasExplicitPackage || !shouldRun);

// Helper function to remove build directories
function cleanBuildArtifacts() {
  const dirs = [
    { name: 'dist', path: path.join(ROOT_DIR, 'dist') },
    { name: 'release', path: path.join(ROOT_DIR, 'release') },
    { name: 'node_modules/.vite', path: path.join(ROOT_DIR, 'node_modules', '.vite') },
  ];
  let cleanedAny = false;
  dirs.forEach(({ name, path: dirPath }) => {
    if (fs.existsSync(dirPath)) {
      log(`Removing ${name}/...`);
      fs.rmSync(dirPath, { recursive: true, force: true });
      cleanedAny = true;
    }
  });
  if (cleanedAny) {
    success('Clean completed: build directories removed.');
  } else {
    log('Build directories already clean.');
  }
}

// Standalone clean command execution
if (onlyClean) {
  header('Cleaning Build Directories');
  cleanBuildArtifacts();
  process.exit(0);
}

header('Basic Pitch Audio-to-MIDI & Stem Extractor');

// 1. Detect Operating System & Architecture
const platform = os.platform(); // 'darwin', 'win32', 'linux'
const arch = os.arch();         // 'arm64', 'x64', etc.
let osName = 'Unknown OS';
let osDetails = '';
let targetFlag = '';

if (platform === 'darwin') {
  osName = 'macOS';
  osDetails = arch === 'arm64' ? 'Apple Silicon (M1/M2/M3/M4)' : 'Intel x64';
  targetFlag = '--mac';
} else if (platform === 'win32') {
  osName = 'Windows';
  osDetails = `Windows ${os.release()} (${arch})`;
  targetFlag = '--win';
} else if (platform === 'linux') {
  osName = 'Linux';
  let distro = '';
  try {
    if (fs.existsSync('/etc/os-release')) {
      const release = fs.readFileSync('/etc/os-release', 'utf8');
      const match = release.match(/PRETTY_NAME="([^"]+)"/);
      if (match) distro = ` (${match[1]})`;
    }
  } catch {}
  osDetails = `${os.type()} ${arch}${distro}`;
  targetFlag = '--linux';
}

log(`Detected Host OS: ${colors.bright}${colors.green}${osName}${colors.reset} [${osDetails}]`);

// 2. Check Node.js Version
const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
if (majorVersion < 18) {
  error(`Node.js version is ${nodeVersion}. Node.js 18.0.0 or higher is required.`);
  process.exit(1);
} else {
  success(`Node.js Runtime: v${nodeVersion}`);
}

// 3. Clean if requested
if (isCleanCommand) {
  log('Cleaning previous build artifacts...');
  cleanBuildArtifacts();
}

// 4. Install Dependencies if needed
log('Checking dependencies in node_modules...');
const nodeModulesPath = path.join(ROOT_DIR, 'node_modules');
const basicPitchPath = path.join(nodeModulesPath, '@spotify', 'basic-pitch');

if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(basicPitchPath)) {
  log('Installing npm dependencies (this may take a moment on first run)...');
  let installResult = spawnSync('npm', ['install'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });

  if (installResult.status !== 0) {
    warn('Standard npm install encountered peer conflicts. Retrying with --legacy-peer-deps...');
    installResult = spawnSync('npm', ['install', '--legacy-peer-deps'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });
  }

  if (installResult.status !== 0) {
    error('Failed to install dependencies. Check npm logs above.');
    process.exit(1);
  }
  success('Dependencies installed successfully.');
} else {
  success('Dependencies are present.');
}

// 5. Verify & Copy Neural Network Model Weights
log('Verifying Spotify Basic Pitch model weights...');
const modelDir = path.join(ROOT_DIR, 'public', 'model');
const modelJson = path.join(modelDir, 'model.json');
const shardBin = path.join(modelDir, 'group1-shard1of1.bin');

if (!fs.existsSync(modelJson) || !fs.existsSync(shardBin)) {
  log('Copying pre-trained model files to public/model/...');
  fs.mkdirSync(modelDir, { recursive: true });
  const pkgModelDir = path.join(ROOT_DIR, 'node_modules', '@spotify', 'basic-pitch', 'model');
  if (fs.existsSync(pkgModelDir)) {
    fs.copyFileSync(path.join(pkgModelDir, 'model.json'), modelJson);
    fs.copyFileSync(path.join(pkgModelDir, 'group1-shard1of1.bin'), shardBin);
    success('Model files copied to public/model.');
  } else {
    warn('Could not locate model files inside @spotify/basic-pitch package.');
  }
} else {
  success('Model weights verified in public/model/.');
}

// 6. Build Web & Desktop Frontend Toolkit
log('Compiling frontend application and DSP audio pipeline...');
const buildResult = spawnSync('npm', ['run', 'build'], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  shell: true,
});

if (buildResult.status !== 0) {
  error('Build failed. Check the compilation logs above.');
  process.exit(1);
}
success('Frontend assets successfully compiled to dist/.');

// 7. Standalone Desktop Packaging or Immediate Execution
if (shouldRun) {
  log(`Launching standalone ${osName} desktop application...`);
  const runResult = spawnSync('npx', ['electron', 'electron/main.cjs'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (runResult.status !== 0) {
    error('Electron exited with an error.');
    process.exit(runResult.status || 1);
  }
} else if (shouldPackage) {
  log(`Packaging standalone native installer for ${colors.bright}${colors.green}${osName}${colors.reset} (${targetFlag})...`);
  log('Running electron-builder (this creates standalone .dmg / .exe / .AppImage)...');

  const packageResult = spawnSync('npx', ['electron-builder', targetFlag], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });

  if (packageResult.status === 0) {
    header('Build & Packaging Succeeded!');
    console.log(`${colors.green}Your standalone desktop toolkit has been packaged for ${osName}!${colors.reset}`);
    console.log(`\nOutput location: ${colors.bright}${colors.cyan}release/${colors.reset}`);

    const releaseDir = path.join(ROOT_DIR, 'release');
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir).filter((f) => !f.startsWith('.'));
      console.log('Generated packages:');
      files.forEach((f) => console.log(`  • ${f}`));
    }

    console.log(`\nTo run the desktop app immediately without rebuilding, run:`);
    console.log(`  ${colors.bright}${colors.cyan}npm run electron${colors.reset}\n`);
  } else {
    warn('electron-builder encountered an issue building native installers.');
    console.log('You can still run the standalone desktop window directly using:');
    console.log(`  ${colors.bright}${colors.cyan}npm run electron:dev${colors.reset}\n`);
  }
} else if (onlyWeb) {
  header('Web Toolkit Build Complete');
  console.log(`Static distribution ready in: ${colors.bright}${colors.cyan}dist/${colors.reset}`);
  console.log('To preview locally:');
  console.log(`  ${colors.bright}${colors.cyan}npm run preview${colors.reset}\n`);
}
