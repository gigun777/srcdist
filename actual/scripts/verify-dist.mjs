import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_OUTPUTS } from './dist_contract.mjs';

export const requiredOutputs = REQUIRED_OUTPUTS;

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function verifyDist(rootDir = path.resolve(new URL('..', import.meta.url).pathname)) {
  const errors = [];
  const projectRoot = rootDir;
  const distDir = path.join(projectRoot, 'dist');
  const metaPath = path.join(distDir, 'build_meta.json');

  if (!(await exists(distDir))) {
    errors.push('Missing dist directory');
  }

  for (const rel of REQUIRED_OUTPUTS) {
    const abs = path.join(projectRoot, rel);
    if (!(await exists(abs))) errors.push(`Missing required output: ${rel}`);
  }

  if (!(await exists(metaPath))) {
    errors.push('Missing build metadata: dist/build_meta.json (run npm run build)');
    return errors;
  }

  const metaRaw = await fs.readFile(metaPath, 'utf8');
  let meta = null;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    errors.push('build_meta.json is not valid JSON');
    return errors;
  }

  if (meta.schemaVersion !== 1) {
    errors.push(`build_meta.json: unsupported schemaVersion ${String(meta.schemaVersion)}`);
  }
  if (typeof meta.stage !== 'string' || !meta.stage.trim()) {
    errors.push('build_meta.json: stage must be a non-empty string');
  }
  if (typeof meta.gitHash !== 'string' || !meta.gitHash.trim()) {
    errors.push('build_meta.json: gitHash must be a non-empty string');
  }

  if (!Array.isArray(meta.outputs)) {
    errors.push('build_meta.json: outputs must be an array');
    return errors;
  }

  if (meta.outputsCount !== meta.outputs.length) {
    errors.push(`build_meta.json: outputsCount mismatch (declared=${String(meta.outputsCount)} actual=${meta.outputs.length})`);
  }

  const dup = meta.outputs.find((rel, idx) => meta.outputs.indexOf(rel) !== idx);
  if (dup) {
    errors.push(`build_meta.json: duplicate output entry: ${dup}`);
  }

  for (const rel of meta.outputs) {
    const abs = path.join(projectRoot, rel);
    if (!(await exists(abs))) errors.push(`build_meta.json references missing file: ${rel}`);
  }

  const outputSet = new Set(meta.outputs);
  for (const rel of REQUIRED_OUTPUTS) {
    if (!outputSet.has(rel)) {
      errors.push(`build_meta.json missing required output entry: ${rel}`);
    }
  }

  return errors;
}

async function main() {
  const errors = await verifyDist();
  if (errors.length) {
    for (const error of errors) console.error(`[verify-dist] ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('[verify-dist] OK');
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error('[verify-dist] failed:', error.message);
    process.exitCode = 1;
  });
}
