/**
 * backup/zip_tools.js
 *
 * Purpose:
 * - Provide minimal ZIP (STORE only) pack/unpack utilities for the Backup Manager.
 * - No compression, ASCII/UTF-8 file names, few files.
 *
 * API:
 *   const { enc, dec, zipStore, zipExtractStoreOnly, zipReadFile } = createZipTools();
 */

export function createZipTools() {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(v) {
    const a = new Uint8Array(2);
    new DataView(a.buffer).setUint16(0, v, true);
    return a;
  }

  function u32(v) {
    const a = new Uint8Array(4);
    new DataView(a.buffer).setUint32(0, v >>> 0, true);
    return a;
  }

  /**
   * @param {{name:string, dataU8:Uint8Array}[]} files
   * @returns {Promise<Blob>}
   */
  async function zipStore(files) { 
    let offset = 0;
    const localParts = [];
    const centralParts = [];

    for (const f of files) {
      const nameU8 = enc.encode(f.name);
      const dataU8 = f.dataU8;
      const crc = crc32(dataU8);

      const local = [
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(dataU8.length),
        u32(dataU8.length),
        u16(nameU8.length),
        u16(0),
        nameU8,
        dataU8,
      ];
      localParts.push(new Blob(local));

      const central = [
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(dataU8.length),
        u32(dataU8.length),
        u16(nameU8.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameU8,
      ];
      centralParts.push(new Blob(central));

      offset += 30 + nameU8.length + dataU8.length;
    }

    const centralStart = offset;
    const centralBlob = new Blob(centralParts);
    const centralSize = (await centralBlob.arrayBuffer()).byteLength;

    const end = [
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralSize),
      u32(centralStart),
      u16(0),
    ];

    return new Blob([...localParts, centralBlob, new Blob(end)], { type: 'application/zip' });
  }

  /** @param {File} file */
  async function zipExtractStoreOnly(file) {
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Reads file bytes from STORE-only ZIP.
   * @param {Uint8Array} zipU8
   * @param {string} filename
   * @returns {Uint8Array|null}
   */
  function zipReadFile(zipU8, filename) {
    const u8 = zipU8;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 65557; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
        const dv = new DataView(u8.buffer, u8.byteOffset + i);
        const cdSize = dv.getUint32(12, true);
        const cdOff = dv.getUint32(16, true);
        let p = cdOff;
        const end = cdOff + cdSize;
        while (p < end) {
          const sig = new DataView(u8.buffer, u8.byteOffset + p).getUint32(0, true);
          if (sig !== 0x02014b50) break;
          const dvh = new DataView(u8.buffer, u8.byteOffset + p);
          const compMethod = dvh.getUint16(10, true);
          const compSize = dvh.getUint32(20, true);
          const nameLen = dvh.getUint16(28, true);
          const extraLen = dvh.getUint16(30, true);
          const commentLen = dvh.getUint16(32, true);
          const lfhOff = dvh.getUint32(42, true);

          const name = dec.decode(u8.slice(p + 46, p + 46 + nameLen));
          if (name === filename) {
            const dvlfh = new DataView(u8.buffer, u8.byteOffset + lfhOff);
            const lnameLen = dvlfh.getUint16(26, true);
            const lextraLen = dvlfh.getUint16(28, true);
            const dataStart = lfhOff + 30 + lnameLen + lextraLen;
            const data = u8.slice(dataStart, dataStart + compSize);
            if (compMethod !== 0) throw new Error('ZIP: unsupported compression method');
            return data;
          }
          p += 46 + nameLen + extraLen + commentLen;
        }
      }
    }
    return null;
  }

  return { enc, dec, zipStore, zipExtractStoreOnly, zipReadFile };
}
