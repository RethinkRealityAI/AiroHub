/**
 * In-browser GLB optimization — no server, no new dependencies.
 *
 * Texture pass: every embedded image larger than 1024px on a side is decoded
 * with createImageBitmap, downscaled to fit 1024², and re-encoded as WebP at
 * ~0.82 quality via canvas. The GLB container is then rewritten by hand:
 *
 *   1. The replaced image bufferView ranges are excised from the BIN chunk and
 *      the new WebP bytes appended at the end (4-byte aligned).
 *   2. Every surviving bufferView offset — including offsets inside
 *      EXT_meshopt_compression extensions — is shifted through a segment map
 *      whose deltas are forced to multiples of 4, so accessor alignment is
 *      preserved without touching a single geometry byte.
 *   3. Image mimeTypes are updated and EXT_texture_webp is declared for
 *      textures that now point at WebP images.
 *
 * The result is only accepted after a full GLTFLoader re-parse; if that fails
 * for any reason the ORIGINAL bytes are returned untouched and the failure is
 * reported, so a broken file can never reach the publish path.
 *
 * Geometry surgery (attribute stripping) is deliberately not attempted —
 * textures dominate the size of these models and the meshopt-compressed
 * geometry streams are not safely editable at the container level.
 */
import { buildGlb, parseGlb, type GltfJson } from './glb';
import { validateModel } from './analyze';

/** Longest allowed texture edge after optimization. */
const MAX_TEXTURE_EDGE = 1024;
const WEBP_QUALITY = 0.82;

const REENCODABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface OptimizeResult {
  /** False when optimization could not run or produced an invalid file. */
  ok: boolean;
  /** True when `buffer` differs from the input. */
  changed: boolean;
  /** Optimized bytes when ok && changed, otherwise the original input. */
  buffer: ArrayBuffer;
  beforeBytes: number;
  afterBytes: number;
  /** Number of images that were downscaled / re-encoded. */
  imagesTouched: number;
  note: string;
}

function unchanged(buffer: ArrayBuffer, ok: boolean, note: string): OptimizeResult {
  return {
    ok,
    changed: false,
    buffer,
    beforeBytes: buffer.byteLength,
    afterBytes: buffer.byteLength,
    imagesTouched: 0,
    note,
  };
}

interface Replacement {
  imageIndex: number;
  bufferViewIndex: number;
  /** Original byte range inside the BIN chunk. */
  start: number;
  end: number;
  bytes: Uint8Array;
  mimeType: string;
  /** Filled in while rebuilding the BIN. */
  newOffset: number;
}

/* ------------------------------------------------------------------
   Image re-encoding
   ------------------------------------------------------------------ */

async function encodeScaled(bitmap: ImageBitmap): Promise<Blob | null> {
  const scale = MAX_TEXTURE_EDGE / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
  );
}

/* ------------------------------------------------------------------
   BIN rebuild
   ------------------------------------------------------------------ */

interface Segment {
  start: number;
  end: number;
  delta: number;
}

/**
 * Rebuilds the BIN with the replaced ranges cut out and new image bytes
 * appended. Returns the new BIN plus a segment map for offset remapping.
 * Every segment delta is a multiple of 4 so existing alignment survives.
 */
function rebuildBin(bin: Uint8Array, replacements: Replacement[]): { out: Uint8Array; segments: Segment[] } {
  const cuts = [...replacements].sort((a, b) => a.start - b.start);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i].start < cuts[i - 1].end) throw new Error('overlapping image bufferViews');
  }

  const parts: Uint8Array[] = [];
  let outLen = 0;
  const push = (bytes: Uint8Array) => {
    if (bytes.length === 0) return;
    parts.push(bytes);
    outLen += bytes.length;
  };
  /** Pads so that (outLen - anchor) becomes a multiple of 4. */
  const padDeltaTo4 = (anchor: number) => {
    const rem = ((outLen - anchor) % 4 + 4) % 4;
    if (rem) push(new Uint8Array(4 - rem));
  };

  const segments: Segment[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start < cursor || cut.end > bin.length) throw new Error('image bufferView out of range');
    padDeltaTo4(cursor);
    segments.push({ start: cursor, end: cut.start, delta: outLen - cursor });
    push(bin.subarray(cursor, cut.start));
    cursor = cut.end;
  }
  padDeltaTo4(cursor);
  segments.push({ start: cursor, end: bin.length, delta: outLen - cursor });
  push(bin.subarray(cursor));

  for (const replacement of replacements) {
    padDeltaTo4(0); // plain 4-alignment for the appended image
    replacement.newOffset = outLen;
    push(replacement.bytes);
  }

  const out = new Uint8Array(outLen);
  let write = 0;
  for (const part of parts) {
    out.set(part, write);
    write += part.length;
  }
  return { out, segments };
}

function remapOffset(offset: number, segments: Segment[]): number {
  for (const segment of segments) {
    if (offset >= segment.start && offset <= segment.end) return offset + segment.delta;
  }
  throw new Error(`bufferView offset ${offset} points inside a replaced image`);
}

/* ------------------------------------------------------------------
   JSON rewrite
   ------------------------------------------------------------------ */

function rewriteJson(
  json: GltfJson,
  replacements: Replacement[],
  segments: Segment[],
  newBinLength: number
): GltfJson {
  const out: GltfJson = structuredClone(json);
  const replacedByView = new Map(replacements.map((r) => [r.bufferViewIndex, r]));

  const bufferViews: GltfJson[] = out.bufferViews ?? [];
  bufferViews.forEach((view, index) => {
    const replacement = replacedByView.get(index);
    if (replacement) {
      view.byteOffset = replacement.newOffset;
      view.byteLength = replacement.bytes.length;
      delete view.byteStride;
      return;
    }
    // Only offsets into the BIN chunk (buffer 0) moved. A meshopt fallback
    // bufferView may target a secondary zero-filled buffer — leave it alone.
    if ((view.buffer ?? 0) === 0) {
      view.byteOffset = remapOffset(view.byteOffset ?? 0, segments);
    }
    const meshoptExt = view.extensions?.EXT_meshopt_compression;
    if (meshoptExt && (meshoptExt.buffer ?? 0) === 0) {
      meshoptExt.byteOffset = remapOffset(meshoptExt.byteOffset ?? 0, segments);
    }
  });

  let anyWebp = false;
  for (const replacement of replacements) {
    const image = out.images?.[replacement.imageIndex];
    if (image) image.mimeType = replacement.mimeType;
    if (replacement.mimeType === 'image/webp') anyWebp = true;
  }

  // Declare EXT_texture_webp on textures that now reference WebP images, so
  // spec-following loaders know what they are looking at. three's GLTFLoader
  // honours the extension; the plain `source` stays as the working fallback.
  if (anyWebp) {
    const webpImages = new Set(
      replacements.filter((r) => r.mimeType === 'image/webp').map((r) => r.imageIndex)
    );
    for (const texture of out.textures ?? []) {
      if (texture.source != null && webpImages.has(texture.source)) {
        texture.extensions = texture.extensions ?? {};
        texture.extensions.EXT_texture_webp = { source: texture.source };
      }
    }
    const used: string[] = (out.extensionsUsed = out.extensionsUsed ?? []);
    if (!used.includes('EXT_texture_webp')) used.push('EXT_texture_webp');
  }

  if (out.buffers?.[0]) out.buffers[0].byteLength = newBinLength;
  return out;
}

/* ------------------------------------------------------------------
   Pipeline
   ------------------------------------------------------------------ */

/**
 * Optimizes a GLB in the browser. Never throws: any failure — unsupported
 * container, canvas encode trouble, or a rewritten file that no longer
 * parses — falls back to the original bytes with `ok`/`note` explaining why.
 */
export async function optimizeGlb(input: ArrayBuffer): Promise<OptimizeResult> {
  try {
    const glb = parseGlb(input);
    if (!glb) return unchanged(input, false, 'Not a binary GLB container — optimization needs an embedded .glb.');
    if (!glb.bin) return unchanged(input, false, 'This GLB has no binary payload to optimize.');

    const { json, bin } = glb;
    const images: GltfJson[] = json.images ?? [];
    const replacements: Replacement[] = [];
    const seenViews = new Set<number>();
    let oversized = 0;

    for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
      const image = images[imageIndex];
      const viewIndex: unknown = image?.bufferView;
      if (typeof viewIndex !== 'number' || seenViews.has(viewIndex)) continue;
      if (!REENCODABLE_MIME.has(image.mimeType)) continue;

      const view = json.bufferViews?.[viewIndex];
      if (!view || (view.buffer ?? 0) !== 0 || view.extensions?.EXT_meshopt_compression) continue;

      const start = view.byteOffset ?? 0;
      const end = start + (view.byteLength ?? 0);
      if (end > bin.length || end <= start) continue;

      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(new Blob([bin.slice(start, end)], { type: image.mimeType }));
      } catch {
        continue; // Undecodable image — leave it as-is.
      }

      try {
        if (Math.max(bitmap.width, bitmap.height) <= MAX_TEXTURE_EDGE) continue;
        oversized += 1;

        const blob = await encodeScaled(bitmap);
        // Browsers without WebP encoding fall back to PNG from canvas; accept
        // either, but only when it actually saves bytes.
        if (!blob || !REENCODABLE_MIME.has(blob.type)) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length >= end - start) continue;

        seenViews.add(viewIndex);
        replacements.push({
          imageIndex,
          bufferViewIndex: viewIndex,
          start,
          end,
          bytes,
          mimeType: blob.type,
          newOffset: 0,
        });
      } finally {
        bitmap.close();
      }
    }

    if (replacements.length === 0) {
      return unchanged(
        input,
        true,
        oversized > 0
          ? 'Oversized textures found, but re-encoding would not shrink them.'
          : images.length > 0
            ? 'All textures are already 1024² or smaller — nothing to optimize.'
            : 'No embedded textures — nothing to optimize.'
      );
    }

    const { out: newBin, segments } = rebuildBin(bin, replacements);
    const newJson = rewriteJson(json, replacements, segments, newBin.length);
    const optimized = buildGlb(newJson, newBin);

    // The gate: the rewritten container must survive a full three.js parse.
    if (!(await validateModel(optimized))) {
      return unchanged(input, false, 'Optimized file failed validation — original kept unchanged.');
    }

    if (optimized.byteLength >= input.byteLength) {
      return unchanged(input, true, 'Optimization produced no net saving — original kept.');
    }

    return {
      ok: true,
      changed: true,
      buffer: optimized,
      beforeBytes: input.byteLength,
      afterBytes: optimized.byteLength,
      imagesTouched: replacements.length,
      note: `${replacements.length} texture${replacements.length === 1 ? '' : 's'} downscaled to ≤${MAX_TEXTURE_EDGE}² WebP.`,
    };
  } catch (err) {
    console.error('[admin] optimize failed', err);
    return unchanged(input, false, 'Optimization unavailable for this file — original kept unchanged.');
  }
}
