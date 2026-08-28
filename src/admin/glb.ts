/**
 * Minimal GLB (binary glTF) container codec.
 *
 * The admin optimizer works directly on the container: it swaps embedded image
 * bytes and rewrites bufferView offsets without ever re-serialising geometry.
 * These helpers own the byte-level layout — 12-byte header, then LE-framed
 * chunks — so `analyze` and `optimize` never touch magic numbers themselves.
 */

export const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type GltfJson = any;

export interface GlbChunks {
  json: GltfJson;
  /** BIN chunk contents; null when the file has no binary payload. */
  bin: Uint8Array | null;
}

export function isGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  return new DataView(buffer).getUint32(0, true) === GLB_MAGIC;
}

/**
 * Splits a GLB into its JSON document and BIN payload.
 * Returns null for anything that is not a well-formed binary glTF.
 */
export function parseGlb(buffer: ArrayBuffer): GlbChunks | null {
  if (!isGlb(buffer)) return null;
  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== 2) return null;

  let offset = 12;
  let json: GltfJson = null;
  let bin: Uint8Array | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > buffer.byteLength) return null;

    if (type === CHUNK_JSON && json === null) {
      try {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
      } catch {
        return null;
      }
    } else if (type === CHUNK_BIN && bin === null) {
      bin = new Uint8Array(buffer, start, length);
    }
    // Chunks are 4-byte aligned; length already includes no padding, so round up.
    offset = start + length + ((4 - (length % 4)) % 4);
  }

  return json ? { json, bin } : null;
}

/**
 * Reads just the glTF JSON document out of a .glb or a plain .gltf buffer.
 * Used for cheap metadata (extensionsUsed) without a full three.js parse.
 */
export function readGltfJson(buffer: ArrayBuffer): GltfJson | null {
  const glb = parseGlb(buffer);
  if (glb) return glb.json;
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    return null;
  }
}

/** Assembles a spec-correct GLB from a JSON document and BIN payload. */
export function buildGlb(json: GltfJson, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4; // spec: pad JSON with spaces
  const binPad = (4 - (bin.length % 4)) % 4; // spec: pad BIN with zeros

  const jsonLen = jsonBytes.length + jsonPad;
  const binLen = bin.length + binPad;
  const total = 12 + 8 + jsonLen + 8 + binLen;

  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  bytes.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) bytes[20 + jsonBytes.length + i] = 0x20;

  const binHeader = 20 + jsonLen;
  view.setUint32(binHeader, binLen, true);
  view.setUint32(binHeader + 4, CHUNK_BIN, true);
  bytes.set(bin, binHeader + 8);
  // ArrayBuffer is zero-initialised, so BIN padding is already correct.

  return out;
}
