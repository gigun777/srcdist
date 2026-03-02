import { promises as fs } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const distDir = path.join(projectRoot, 'dist');
const metaPath = path.join(distDir, 'build_meta.json');

const requiredOutputs = [
  'dist/index.js',
  'dist/styles.css',
  'dist/ui/ui_core.js',
  'dist/ui/ui_bootstrap_esm.js',
  'dist/ui/sws_v2/sws_modal.js',
  'dist/ui/sws_v2/sws_modal.css'
];

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const errors = [];

  if (!(await exists(distDir))) {
    errors.push('Missing dist directory');
  }

  for (const rel of requiredOutputs) {
    const abs = path.join(projectRoot, rel);
    if (!(await exists(abs))) errors.push(`Missing required output: ${rel}`);
  }

  if (!(await exists(metaPath))) {
    errors.push('Missing build metadata: dist/build_meta.json (run npm run build)');
  } else {
    const metaRaw = await fs.readFile(metaPath, 'utf8');
    let meta = null;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      errors.push('build_meta.json is not valid JSON');
    }

    if (meta) {
      if (!Array.isArray(meta.outputs)) {
        errors.push('build_meta.json: outputs must be an array');
      } else {
        for (const rel of meta.outputs) {
          const abs = path.join(projectRoot, rel);
          if (!(await exists(abs))) errors.push(`build_meta.json references missing file: ${rel}`);
        }
      }
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`[verify-dist] ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('[verify-dist] OK');
}

main().catch((error) => {
  console.error('[verify-dist] failed:', error.message);
  process.exitCode = 1;
});
