// backup_v2_zip_store.js
// Minimal ZIP (STORE) writer + central directory reader.
// Supports reading STORE entries. If entry uses DEFLATE (method 8) we throw a clear error.
// This is intentional for v2 because current exporter uses STORE for speed and simplicity.

function u16(v){ return v & 0xFFFF; }
function u32(v){ return v >>> 0; }

function le16(n){ return new Uint8Array([n & 255, (n>>>8)&255]); }
function le32(n){ return new Uint8Array([n & 255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255]); }

function concat(chunks){
  const total = chunks.reduce((s,c)=>s + c.length, 0);
  const out = new Uint8Array(total);
  let o=0;
  for(const c of chunks){ out.set(c, o); o += c.length; }
  return out;
}

function textEncode(s){ return new TextEncoder().encode(s); }
function textDecode(u8){ return new TextDecoder('utf-8').decode(u8); }

function crc32(u8){
  // standard CRC32
  let crc = 0xFFFFFFFF;
  for (let i=0;i<u8.length;i++){
    crc ^= u8[i];
    for (let k=0;k<8;k++){
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xEDB88320 & mask);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findEOCD(view){
  // EOCD signature 0x06054b50
  const sig = 0x06054b50;
  const maxComment = 0xFFFF;
  const start = Math.max(0, view.byteLength - (22 + maxComment));
  for(let i=view.byteLength - 22; i>=start; i--){
    if(view.getUint32(i, true) === sig){
      return i;
    }
  }
  return -1;
}

export function listZipEntries(arrayBuffer){
  const view = new DataView(arrayBuffer);
  const eocdOff = findEOCD(view);
  if(eocdOff < 0) throw new Error('ZIP: EOCD not found');
  const cdSize = view.getUint32(eocdOff + 12, true);
  const cdOff  = view.getUint32(eocdOff + 16, true);
  const total  = view.getUint16(eocdOff + 10, true);
  const entries = [];
  let p = cdOff;
  for(let idx=0; idx<total; idx++){
    const sig = view.getUint32(p, true);
    if(sig !== 0x02014b50) throw new Error('ZIP: Central directory entry signature mismatch');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(arrayBuffer, p + 46, nameLen);
    const name = textDecode(nameBytes);
    entries.push({ name, method, crc32: crc, compressedSize: compSize, uncompressedSize: uncompSize, localHeaderOffset: lho });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(arrayBuffer, name){
  const entries = listZipEntries(arrayBuffer);
  const ent = entries.find(e => e.name === name);
  if(!ent) return null;
  const view = new DataView(arrayBuffer);
  const p = ent.localHeaderOffset;
  const sig = view.getUint32(p, true);
  if(sig !== 0x04034b50) throw new Error('ZIP: Local header signature mismatch');
  const method = view.getUint16(p + 8, true);
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const dataOff = p + 30 + nameLen + extraLen;
  const data = new Uint8Array(arrayBuffer, dataOff, ent.compressedSize);
  if(method === 0){
    return new Uint8Array(data); // copy
  }
  if(method === 8){
    throw new Error('ZIP: DEFLATE entries are not supported in v2 STORE parser yet (method=8). Re-export using v2 exporter.');
  }
  throw new Error('ZIP: Unsupported compression method=' + method);
}

export function makeZipStore(files){
  // files: [{name: string, data: Uint8Array}]
  const locals = [];
  const centrals = [];
  let offset = 0;

  for(const f of files){
    const nameBytes = textEncode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const compSize = data.length;
    const uncompSize = data.length;

    // Local file header
    const localHeader = concat([
      le32(0x04034b50),
      le16(20), // version needed
      le16(0),  // flags
      le16(0),  // method STORE
      le16(0), le16(0), // time/date
      le32(crc),
      le32(compSize),
      le32(uncompSize),
      le16(nameBytes.length),
      le16(0), // extra len
      nameBytes,
      data
    ]);
    locals.push(localHeader);

    // Central directory header
    const centralHeader = concat([
      le32(0x02014b50),
      le16(20), // version made by
      le16(20), // version needed
      le16(0),  // flags
      le16(0),  // method
      le16(0), le16(0),
      le32(crc),
      le32(compSize),
      le32(uncompSize),
      le16(nameBytes.length),
      le16(0), // extra
      le16(0), // comment
      le16(0), // disk start
      le16(0), // internal attrs
      le32(0), // external attrs
      le32(offset),
      nameBytes
    ]);
    centrals.push(centralHeader);

    offset += localHeader.length;
  }

  const cdOffset = offset;
  const cd = concat(centrals);
  offset += cd.length;

  const eocd = concat([
    le32(0x06054b50),
    le16(0), le16(0), // disk numbers
    le16(files.length),
    le16(files.length),
    le32(cd.length),
    le32(cdOffset),
    le16(0) // comment length
  ]);

  return concat([...locals, cd, eocd]);
}
