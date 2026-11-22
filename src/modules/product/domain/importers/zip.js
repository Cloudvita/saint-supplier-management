// @ts-check
import { inflateRawSync } from "node:zlib";

/**
 * ZIP reader on Node's built-in zlib — no npm package.
 *
 * Reads the central directory (the zip's own table of contents), lets the
 * caller choose entries by name and declared size, and inflates only those.
 * Each inflate is capped at its declared size, so an entry that lies about
 * how big it is cannot expand past what the caller agreed to. Stored (0) and
 * deflated (8) entries are supported; ZIP64 and encrypted archives are not.
 */

/**
 * @typedef {{ name: string; originalSize: number; compressedSize: number; method: number }} ZipEntryInfo
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * @param {Uint8Array} data
 * @returns {DataView}
 */
function view(data) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * @param {Uint8Array} data
 * @returns {number} offset of the end-of-central-directory record
 */
function findEndOfDirectory(data) {
  const dv = view(data);
  // The record is 22 bytes plus a comment of up to 65,535 bytes, at the end.
  const stop = Math.max(0, data.byteLength - 22 - 0xffff);
  for (let i = data.byteLength - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new SyntaxError("no end-of-central-directory record (not a zip file, or truncated)");
}

/**
 * Entries of a zip, without inflating anything.
 * @param {Uint8Array} data
 * @returns {Array<ZipEntryInfo & { localOffset: number }>}
 */
export function listZip(data) {
  const dv = view(data);
  const eocd = findEndOfDirectory(data);
  const count = dv.getUint16(eocd + 10, true);
  const dirOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new SyntaxError("ZIP64 archives are not supported");

  const decoder = new TextDecoder("utf-8");
  /** @type {Array<ZipEntryInfo & { localOffset: number }>} */
  const entries = [];
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.byteLength || dv.getUint32(p, true) !== CENTRAL_SIGNATURE) {
      throw new SyntaxError("corrupt central directory");
    }
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const originalSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    if (flags & 0x1) throw new SyntaxError(`${name}: encrypted zip entries are not supported`);
    entries.push({ name, method, compressedSize, originalSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Inflate the entries `filter` accepts. `filter` sees each entry's declared
 * sizes first and may throw to abandon the whole archive.
 * @param {Uint8Array} data
 * @param {(entry: ZipEntryInfo) => boolean} [filter]
 * @returns {Record<string, Uint8Array>}
 */
export function unzip(data, filter = () => true) {
  const dv = view(data);
  /** @type {Record<string, Uint8Array>} */
  const out = {};
  for (const e of listZip(data)) {
    if (!filter({ name: e.name, method: e.method, compressedSize: e.compressedSize, originalSize: e.originalSize })) continue;
    const p = e.localOffset;
    if (p + 30 > data.byteLength || dv.getUint32(p, true) !== LOCAL_SIGNATURE) throw new SyntaxError(`${e.name}: corrupt local header`);
    const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
    const raw = data.subarray(start, start + e.compressedSize);
    if (raw.byteLength !== e.compressedSize) throw new SyntaxError(`${e.name}: truncated`);
    if (e.method === 0) {
      out[e.name] = raw;
    } else if (e.method === 8) {
      // maxOutputLength: zlib stops rather than exceed the declared size.
      let inflated;
      try {
        inflated = inflateRawSync(raw, { maxOutputLength: Math.max(e.originalSize, 1) });
      } catch (err) {
        const reason = err instanceof RangeError ? "inflates past the size its zip directory declares" : "is not valid deflate data";
        throw new SyntaxError(`${e.name} ${reason}`);
      }
      if (inflated.byteLength !== e.originalSize) throw new SyntaxError(`${e.name}: size does not match the zip directory`);
      out[e.name] = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    } else {
      throw new SyntaxError(`${e.name}: unsupported compression method ${e.method}`);
    }
  }
  return out;
}
