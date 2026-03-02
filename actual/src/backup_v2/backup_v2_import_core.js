// Backup v2 - Import Core (dry-run only)
// No UI dependencies. Supports STORE and DEFLATE entries.

import { listZipEntries, readZipEntry } from './backup_v2_zip_store.js';

const dec = new TextDecoder();

export async function dryRunImportZipV2(input){
  const report = {
    ok: false,
    manifestFound: false,
    filesInZipCount: 0,
    filesInZip: [],
    missingFiles: [],
    warnings: [],
    manifest: null,
  };

  let ab;
  if(input instanceof ArrayBuffer){
    ab = input;
  } else if(input && typeof input.arrayBuffer === 'function'){
    ab = await input.arrayBuffer();
  } else {
    throw new Error('dryRunImportZipV2: expected File/Blob or ArrayBuffer');
  }

  const cd = listZipEntries(ab);
  report.filesInZipCount = cd.length;
  report.filesInZip = cd.map(f=>f.name);

  const manifestU8 = await readZipEntry(ab, 'manifest.json');
  if(!manifestU8){
    report.manifestFound = false;
    // Legacy v1 detection (backup.json)
    const legacyU8 = await readZipEntry(ab, 'backup.json');
    if(legacyU8){
      report.legacyV1Found = true;
      report.error = { code:'legacy_v1_unsupported', message:'Legacy backup v1 (backup.json) is not supported. Please use ZIP v2 export (manifest.json).' };
      report.warnings.push('legacy v1 unsupported');
      return report;
    }
    report.warnings.push('manifest.json not found');
    return report;
  }

  report.manifestFound = true;
  let manifest;
  try{
    manifest = JSON.parse(dec.decode(manifestU8));
  }catch(e){
    report.warnings.push('manifest.json parse failed');
    return report;
  }
  report.manifest = manifest;

  if(!manifest || manifest.format !== 'sdo-backup-zip' || manifest.version !== 2){
    report.warnings.push('unsupported manifest format/version');
  }

  const expected = [];
  // expected files from manifest.files
  if(manifest?.files){
    for(const key of Object.keys(manifest.files)){
      const arr = manifest.files[key];
      if(Array.isArray(arr)) expected.push(...arr);
    }
  }
  // Always require manifest.json itself
  expected.push('manifest.json');

  const present = new Set(report.filesInZip);
  const missing = [];
  for(const name of expected){
    if(typeof name === 'string' && name && !present.has(name)) missing.push(name);
  }
  report.missingFiles = missing;
  report.ok = report.manifestFound && missing.length === 0;

  return report;
}
