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
