import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const distDir = path.join(projectRoot, 'dist');
const metaPath = path.join(distDir, 'build_meta.json');

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'copy-safe';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}


async function copyDirRecursive(srcDir, dstDir) {
  const items = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(dstDir, { recursive: true });
  for (const item of items) {
    const src = path.join(srcDir, item.name);
    const dst = path.join(dstDir, item.name);
    if (item.isDirectory()) {
      await copyDirRecursive(src, dst);
    } else {
      await fs.copyFile(src, dst);
    }
  }
}

async function walkFiles(dir, acc = []) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      await walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}


async function syncAlternativeAArtifacts() {
  const srcAdapter = path.join(projectRoot, 'src/ui/sws_v2/sws_adapter.js');
  const distAdapter = path.join(projectRoot, 'dist/ui/sws_v2/sws_adapter.js');

  if (await pathExists(srcAdapter)) {
    await fs.mkdir(path.dirname(distAdapter), { recursive: true });
    await fs.copyFile(srcAdapter, distAdapter);
  }



  const srcTable = path.join(projectRoot, 'src/table');
  const distTable = path.join(projectRoot, 'dist/table');
  if (await pathExists(srcTable)) {
    await copyDirRecursive(srcTable, distTable);
  }

  const srcDebugCenter = path.join(projectRoot, 'src/ui/ui_debug_center.js');
  const distDebugCenter = path.join(projectRoot, 'dist/ui/ui_debug_center.js');
  if (await pathExists(srcDebugCenter)) {
    await fs.mkdir(path.dirname(distDebugCenter), { recursive: true });
    await fs.copyFile(srcDebugCenter, distDebugCenter);
  }

  const srcSettingsShell = path.join(projectRoot, 'src/ui/settings/settings_shell_modal.js');
  const distSettingsShell = path.join(projectRoot, 'dist/ui/settings/settings_shell_modal.js');
  if (await pathExists(srcSettingsShell)) {
    await fs.mkdir(path.dirname(distSettingsShell), { recursive: true });
    await fs.copyFile(srcSettingsShell, distSettingsShell);
  }

  const distBootstrap = path.join(projectRoot, 'dist/ui/ui_bootstrap_esm.js');
  if (!(await pathExists(distBootstrap))) return;

  let code = await fs.readFile(distBootstrap, 'utf8');
  const importLine = 'import { createSwsAdapter } from "./sws_v2/sws_adapter.js";';
  if (!code.includes(importLine)) {
    const marker = 'import "./ui_backup.js";\n';
    if (code.includes(marker)) code = code.replace(marker, marker + importLine + '\n');
  }

  const adapterBlock = `
  // Strangler Adapter (Alternative A): one router for old/new modal channels.
  const swsAdapter = createSwsAdapter({
    getSettingsWindow: () => global.SettingsWindow || null,
    openLegacyModal: (legacyPayload) => {
      const modal = global.UI?.modal;
      if (!modal || typeof modal.open !== 'function') {
        throw new Error('Legacy modal channel is unavailable (UI.modal.open missing)');
      }
      return modal.open(legacyPayload);
    }
  });
  UI.swsAdapter = swsAdapter;
  global.SWSAdapter = swsAdapter;
`;

  if (!code.includes('UI.swsAdapter = swsAdapter;')) {
    const insertionPoint = '  if (!tryAttachTransfer()) {\n';
    const idx = code.indexOf(insertionPoint);
    if (idx !== -1) {
      const endBlock = code.indexOf('  // 2) Theme init (ESM theme runtime)', idx);
      if (endBlock !== -1) {
        code = code.slice(0, endBlock) + adapterBlock + '\n' + code.slice(endBlock);
      }
    }
  }

  await fs.writeFile(distBootstrap, code, 'utf8');
}

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  if (!(await pathExists(distDir))) {
    throw new Error('dist directory is missing. Build D0 copy-safe mode requires existing dist.');
  }

  await syncAlternativeAArtifacts();

  const allFiles = await walkFiles(distDir);
  const outputs = allFiles
    .map((file) => path.relative(projectRoot, file).replaceAll(path.sep, '/'))
    .filter((file) => file !== 'dist/build_meta.json')
    .sort();

  const meta = {
    schemaVersion: 1,
    stage: 'D1',
    mode,
    createdAt: new Date().toISOString(),
    gitHash: getGitHash(),
    outputsCount: outputs.length,
    outputs
  };

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  process.stdout.write(`build_meta.json generated: ${path.relative(projectRoot, metaPath)}\n`);
  process.stdout.write(`outputs: ${outputs.length}\n`);
}

main().catch((error) => {
  console.error('[build] failed:', error.message);
  process.exitCode = 1;
});
