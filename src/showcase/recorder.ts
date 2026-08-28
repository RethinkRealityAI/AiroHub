/**
 * Showcase turntable recorder.
 *
 * Captures a cinematic 360-degree orbit of the painted piece straight off the
 * live WebGL canvas. The whole thing is deliberately free of React, three.js
 * and app imports so it can be unit-tested against a plain <canvas> and a stub
 * orbit object.
 *
 * How the capture works
 * ---------------------
 * `canvas.captureStream(fps)` taps the canvas' own presentation pipeline and
 * hands back a live `MediaStream`. It does NOT require `preserveDrawingBuffer`
 * — unlike `toDataURL()` / `readPixels`, the browser feeds the stream from the
 * frames the canvas has already composited, so a default r3f canvas records
 * perfectly well. The stream is piped into a `MediaRecorder` that muxes WebM.
 *
 * How the sweep works
 * -------------------
 * We drive drei's OrbitControls directly rather than using its `autoRotate`,
 * because autoRotate advances by wall-clock delta and cannot be made to land
 * on exactly one revolution in exactly N seconds. Instead each animation frame
 * sets an absolute azimuth: `start + ease(t) * 2PI`. `ease` ramps the angular
 * velocity up over the first slice and back down over the last, which reads as
 * a camera move rather than a spinning prop. The prior azimuth and the prior
 * `autoRotate` flag are restored when the sweep ends, aborts or throws.
 */

/* ------------------------------------------------------------------
   Contract
   ------------------------------------------------------------------ */

/**
 * Everything the recorder needs from the studio, supplied by the mounting
 * component. Both getters are called lazily (never at mount time) so a ref
 * that is still `null` mid-load is a handled state, not a crash.
 */
export interface ShowcaseHandles {
  /** The WebGL canvas to capture (r3f `gl.domElement`). */
  getCanvas: () => HTMLCanvasElement | null;
  /** OrbitControls instance ref (drei) — has getAzimuthalAngle/setAzimuthalAngle, autoRotate props, update(). */
  getOrbit: () => any | null;
  roomId: string;
}

/** Progress reporter: `t` runs 0 -> 1 across the sweep. */
export type ShowcaseProgress = (t: number) => void;

/** Result of the capability probe, with a human-readable reason when false. */
export interface ShowcaseSupport {
  supported: boolean;
  /** Present only when `supported` is false. Safe to render verbatim. */
  reason?: string;
}

/** Duration choices the panel offers. */
export type ShowcaseSeconds = 6 | 10;

/* ------------------------------------------------------------------
   Tunables
   ------------------------------------------------------------------ */

/** Requested capture rate. The browser may deliver fewer frames under load. */
const CAPTURE_FPS = 60;

/** Recorder chunk cadence, ms. Small enough that a short clip still flushes. */
const CHUNK_MS = 100;

/** Fraction of the sweep spent easing in, and again easing out. */
const EASE_RAMP = 0.18;

/** Extra ms of recording after the sweep lands, so the final frames are muxed. */
const TAIL_MS = 140;

/** Hard ceiling on waiting for `onstop`, in case the recorder never settles. */
const STOP_TIMEOUT_MS = 4000;

/** Candidate containers, best first. The empty string means "recorder default". */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  '',
] as const;

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------
   Capability probing
   ------------------------------------------------------------------ */

/**
 * True when this browser can do canvas capture at all. Called by the panel
 * before it offers anything, so an unsupported browser sees an explanation
 * instead of a button that throws.
 */
export function checkShowcaseSupport(): ShowcaseSupport {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Recording is only available in a browser.' };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      supported: false,
      reason: 'This browser has no MediaRecorder, so video capture is unavailable. Chrome, Edge or Firefox on desktop will work.',
    };
  }
  const proto = typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null;
  if (!proto || typeof (proto as any).captureStream !== 'function') {
    return {
      supported: false,
      reason: 'This browser cannot stream frames from a canvas, so the turntable cannot be captured here.',
    };
  }
  if (pickMimeType() === null) {
    return {
      supported: false,
      reason: 'This browser has no WebM video encoder available for recording.',
    };
  }
  return { supported: true };
}

/**
 * First container this browser will actually record.
 * Returns `''` to mean "let the recorder choose", or `null` when even the
 * default is refused.
 */
export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const isTypeSupported =
    typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
      : null;

  for (const candidate of MIME_CANDIDATES) {
    // The empty candidate is the "recorder default" escape hatch; there is
    // nothing to probe, so accept it as the last resort.
    if (candidate === '') return '';
    if (!isTypeSupported) continue;
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      /* Some engines throw on odd codec strings — treat as unsupported. */
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   Easing
   ------------------------------------------------------------------ */

/**
 * Eased progress with a flat middle: angular velocity smoothly ramps up over
 * the first `ramp` of the clip, holds constant, then ramps back down. Returns
 * 0 at t=0 and exactly 1 at t=1 for any ramp in [0, 0.5].
 *
 * Derived by integrating a smoothstep velocity profile and normalising the
 * total area to 1, which is why the constant-speed section is `1 / (1 - ramp)`
 * rather than 1.
 */
export function cinematicEase(t: number, ramp: number = EASE_RAMP): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const r = Math.min(Math.max(ramp, 0), 0.5);
  if (r <= 0) return x;

  // Integral of the smoothstep velocity 3u^2 - 2u^3 over [0, u].
  const rampArea = (u: number) => u * u * u - (u * u * u * u) / 2;
  const total = 1 - r;

  let raw: number;
  if (x <= r) {
    raw = r * rampArea(x / r);
  } else if (x <= 1 - r) {
    raw = r * 0.5 + (x - r);
  } else {
    raw = total - r * rampArea((1 - x) / r);
  }
  return raw / total;
}

/* ------------------------------------------------------------------
   Orbit adapter
   ------------------------------------------------------------------ */

interface OrbitAdapter {
  /** False when the ref was null or did not look like OrbitControls. */
  live: boolean;
  startAzimuth: number;
  setAzimuth: (angle: number) => void;
  update: () => void;
  restore: () => void;
}

/**
 * Wraps whatever `getOrbit()` returned in a total interface. A null ref, a
 * half-initialised object, or a controls instance whose methods throw all
 * degrade to a no-op adapter, so the recording still produces a valid clip
 * (a held shot) instead of rejecting.
 */
function adaptOrbit(raw: unknown): OrbitAdapter {
  const controls = raw as any;
  const usable =
    !!controls &&
    typeof controls.setAzimuthalAngle === 'function' &&
    typeof controls.getAzimuthalAngle === 'function';

  if (!usable) {
    return {
      live: false,
      startAzimuth: 0,
      setAzimuth: () => {},
      update: () => {},
      restore: () => {},
    };
  }

  let startAzimuth = 0;
  try {
    const value = controls.getAzimuthalAngle();
    if (Number.isFinite(value)) startAzimuth = value;
  } catch {
    /* keep 0 */
  }

  const hadAutoRotate = controls.autoRotate === true;
  // A user-driven inertial glide would fight the scripted sweep, so damping is
  // suspended for the take and put back exactly as found.
  const hadDamping = controls.enableDamping === true;
  let restored = false;

  try {
    controls.autoRotate = false;
    controls.enableDamping = false;
  } catch {
    /* Read-only props on an exotic controls impl — harmless. */
  }

  return {
    live: true,
    startAzimuth,
    setAzimuth: (angle: number) => {
      try {
        controls.setAzimuthalAngle(angle);
      } catch {
        /* ignore a frame we could not drive */
      }
    },
    update: () => {
      try {
        if (typeof controls.update === 'function') controls.update();
      } catch {
        /* ignore */
      }
    },
    restore: () => {
      if (restored) return;
      restored = true;
      try {
        controls.setAzimuthalAngle(startAzimuth);
        controls.autoRotate = hadAutoRotate;
        controls.enableDamping = hadDamping;
        if (typeof controls.update === 'function') controls.update();
      } catch {
        /* ignore */
      }
    },
  };
}

/* ------------------------------------------------------------------
   Recording
   ------------------------------------------------------------------ */

/** Thrown for every predictable failure so the panel can show `err.message`. */
export class ShowcaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShowcaseError';
  }
}

/**
 * Record one full turntable revolution of the studio canvas.
 *
 * Saves the orbit's azimuth and autoRotate state, sweeps a full 2PI over
 * `seconds` (eased at both ends), records exactly that long, restores the
 * camera, and resolves with the encoded WebM.
 *
 * @param handles  canvas + orbit accessors, called lazily
 * @param seconds  sweep length; clamped to 1..60
 * @param onProgress optional 0..1 reporter, called every animation frame
 * @param signal   optional abort — rejects with a ShowcaseError and restores
 *                 the camera, leaving nothing running
 */
export function recordTurntable(
  handles: ShowcaseHandles,
  seconds: number,
  onProgress?: ShowcaseProgress,
  signal?: AbortSignal
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const support = checkShowcaseSupport();
    if (!support.supported) {
      reject(new ShowcaseError(support.reason ?? 'Recording is not supported in this browser.'));
      return;
    }

    const canvas = safeCall(handles.getCanvas);
    if (!canvas) {
      reject(new ShowcaseError('The studio canvas is not ready yet. Give it a moment and try again.'));
      return;
    }
    if (typeof (canvas as any).captureStream !== 'function') {
      reject(new ShowcaseError('This canvas cannot be streamed for capture in this browser.'));
      return;
    }

    const durationMs = Math.min(Math.max(Number(seconds) || 0, 1), 60) * 1000;

    let stream: MediaStream;
    try {
      stream = canvas.captureStream(CAPTURE_FPS);
    } catch (err) {
      reject(new ShowcaseError(`Could not capture the canvas: ${describe(err)}`));
      return;
    }
    if (!stream || typeof stream.getTracks !== 'function' || stream.getTracks().length === 0) {
      reject(new ShowcaseError('The canvas produced no video track to record.'));
      return;
    }

    const mime = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      stopTracks(stream);
      reject(new ShowcaseError(`Could not start the video recorder: ${describe(err)}`));
      return;
    }

    const orbit = adaptOrbit(safeCall(handles.getOrbit));
    const chunks: Blob[] = [];

    let rafId = 0;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    let tailTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let finishing = false;

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (stopTimer) clearTimeout(stopTimer);
      if (tailTimer) clearTimeout(tailTimer);
      stopTimer = null;
      tailTimer = null;
      if (signal) signal.removeEventListener('abort', onAbort);
      orbit.restore();
      stopTracks(stream);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ignore */
      }
      cleanup();
      reject(new ShowcaseError(message));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const type = (recorder.mimeType && recorder.mimeType.length > 0 ? recorder.mimeType : 'video/webm')
        .split(';')[0];
      const blob = new Blob(chunks, { type: type || 'video/webm' });
      if (blob.size === 0) {
        reject(new ShowcaseError('The recording came back empty. Try again with the studio tab in focus.'));
        return;
      }
      resolve(blob);
    };

    function onAbort() {
      fail('Recording cancelled.');
    }

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new ShowcaseError('Recording cancelled.'));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event: Event) => {
      const detail = (event as any)?.error;
      fail(`The recorder failed: ${describe(detail ?? event)}`);
    };
    recorder.onstop = () => {
      succeed();
    };

    try {
      recorder.start(CHUNK_MS);
    } catch (err) {
      cleanup();
      reject(new ShowcaseError(`Could not start the video recorder: ${describe(err)}`));
      return;
    }

    /** Ends the take: hold the last frame briefly, then flush the muxer. */
    const finish = () => {
      if (settled || finishing) return;
      finishing = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      // Drop the wall-clock backstop; the slot is reused for the stop timeout.
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = null;
      orbit.restore();
      report(1);
      tailTimer = setTimeout(() => {
        if (settled) return;
        try {
          if (recorder.state !== 'inactive') recorder.stop();
          else succeed();
        } catch (err) {
          fail(`Could not finish the recording: ${describe(err)}`);
          return;
        }
        // If `onstop` never lands, settle with whatever was muxed.
        stopTimer = setTimeout(() => succeed(), STOP_TIMEOUT_MS);
      }, TAIL_MS);
    };

    const report = (t: number) => {
      if (!onProgress) return;
      try {
        onProgress(t);
      } catch {
        /* a throwing consumer must not kill the take */
      }
    };

    const started = now();
    const tick = () => {
      if (settled) return;
      const elapsed = now() - started;
      const t = Math.min(Math.max(elapsed / durationMs, 0), 1);

      if (orbit.live) {
        orbit.setAzimuth(orbit.startAzimuth + cinematicEase(t) * TAU);
        orbit.update();
      }
      report(t);

      if (t >= 1) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    // Drive the first frame immediately so the sweep starts on the same frame
    // the recorder did, then hand over to rAF.
    rafId = requestAnimationFrame(tick);

    // Backstop: a backgrounded tab throttles or halts rAF, which would leave
    // the recorder running forever. Wall-clock timer ends the take regardless.
    stopTimer = setTimeout(() => finish(), durationMs + 1500);
  });
}

/* ------------------------------------------------------------------
   Delivery
   ------------------------------------------------------------------ */

/** `airohub-<room>-showcase.webm`, with the room slugged for filesystem safety. */
export function showcaseFileName(roomId: string): string {
  const slug = String(roomId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `airohub-${slug || 'studio'}-showcase.webm`;
}

/**
 * Push a blob at the browser's download manager. Returns false when the
 * environment blocked it, so the caller can leave the preview's own controls
 * as the fallback route.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  } finally {
    // The click has already been dispatched synchronously; give the browser a
    // beat before reclaiming the URL.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/* ------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------ */

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function safeCall<T>(getter: (() => T | null) | undefined): T | null {
  if (typeof getter !== 'function') return null;
  try {
    return getter() ?? null;
  } catch {
    return null;
  }
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream || typeof stream.getTracks !== 'function') return;
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function describe(err: unknown): string {
  if (!err) return 'unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const name = (err as any)?.name;
  return typeof name === 'string' ? name : 'unknown error';
}
