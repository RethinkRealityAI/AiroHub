/**
 * The shared-password admin session.
 *
 * `/admin` is one owner behind one password, so the session is a signed value
 * in an HttpOnly cookie rather than a user table. Three properties are load
 * bearing, and each one is a real failure this module exists to prevent:
 *
 *  - The password comparison is constant time and ALWAYS runs, including when
 *    the submitted value is obviously wrong. A `===` on secrets leaks their
 *    length and prefix through response timing; returning early on a missing
 *    field leaks whether the endpoint is configured at all.
 *  - The signature is verified BEFORE the expiry. Checking expiry first tells
 *    an attacker holding a forged cookie whether their guessed `exp` is in the
 *    future — an oracle that turns forgery into a search problem. It also means
 *    a tampered timestamp reports `bad-signature`, which is the truth, instead
 *    of `expired`, which invites a retry.
 *  - The cookie is HttpOnly + Secure + SameSite=Strict on path `/`. Strict is
 *    affordable because nothing links into `/admin` from another origin, and it
 *    is what keeps a cross-site POST from acting as the owner.
 *
 * This module deliberately imports nothing but `node:crypto`. It does not reuse
 * `lib/db.ts`'s `json()`: that would drag `@netlify/database` (and pg, ws) into
 * every bundle that only needs to check a cookie, and into a unit test that has
 * no database at all.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from '@netlify/functions';

export const SESSION_COOKIE = 'airo_admin';
/** Long enough to work through a launch day, short enough that a stolen laptop expires. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Below this a secret is a password, not a key; refuse to sign with it. */
export const SESSION_SECRET_MIN = 24;

export interface AdminEnv {
  password: string;
  secret: string;
}

export type SessionFailure = 'absent' | 'malformed' | 'bad-signature' | 'expired';

/**
 * Callers must discriminate with `result.ok === true` / `result.ok === false`,
 * not `if (result.ok)` or `if (!result.ok)`. The repo compiles without
 * `strictNullChecks`, and in that mode TypeScript does not narrow a union by
 * the truthiness of a boolean-literal discriminant — the shorthand silently
 * leaves `result` as the whole union and `result.reason` is a compile error.
 */
export type SessionResult = { ok: true; expiresAt: number } | { ok: false; reason: SessionFailure };

/**
 * Compare two secrets without leaking their contents through timing. Hashing
 * first is what makes unequal lengths safe: `timingSafeEqual` throws on
 * mismatched buffer lengths, and a thrown comparison is itself a length oracle.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(String(a), 'utf8').digest();
  const right = createHash('sha256').update(String(b), 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** 128 bits of randomness, so two sessions minted in the same millisecond differ. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** `exp.nonce.hmac` — the whole session. Nothing about the owner is in it. */
export function signSession(secret: string, exp: number, nonce: string): string {
  const body = `${exp}.${nonce}`;
  const mac = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `${body}.${mac}`;
}

/** Mint a fresh session token valid for `SESSION_TTL_MS`. */
export function createSession(secret: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS;
  return { token: signSession(secret, expiresAt, newNonce()), expiresAt };
}

/**
 * Signature first, expiry second. See the module comment: the order is the
 * security property, not a style choice.
 */
export function verifySession(secret: string, token: string | undefined | null, now = Date.now()): SessionResult {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'absent' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [rawExp, nonce, mac] = parts;
  if (!/^\d{1,15}$/.test(rawExp) || !/^[0-9a-f]{8,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(mac)) {
    return { ok: false, reason: 'malformed' };
  }

  if (!constantTimeEqual(signSession(secret, Number(rawExp), nonce), token)) {
    return { ok: false, reason: 'bad-signature' };
  }

  const expiresAt = Number(rawExp);
  if (expiresAt <= now) return { ok: false, reason: 'expired' };

  return { ok: true, expiresAt };
}

/**
 * Both variables or nothing. A half-configured admin endpoint that accepts an
 * empty password is worse than one that refuses to run, so this returns `null`
 * and the callers answer 503 rather than guessing a default.
 */
export function readAdminEnv(): AdminEnv | null {
  const password = process.env.ADMIN_PASSWORD ?? '';
  const secret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (password.length === 0) return null;
  if (secret.length < SESSION_SECRET_MIN) return null;
  return { password, secret };
}

export function readSessionCookie(context: Context): string {
  try {
    return context.cookies.get(SESSION_COOKIE) ?? '';
  } catch {
    // A request with no cookie header at all: not an error, just no session.
    return '';
  }
}

export function setSessionCookie(context: Context, token: string, expiresAt: number, now = Date.now()): void {
  context.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.max(0, Math.round((expiresAt - now) / 1000)),
  });
}

/**
 * `cookies.delete` is the platform's own expiry helper (it emits the cookie
 * back with `Max-Age=0`); the path has to match the one it was set with or the
 * browser keeps the original.
 */
export function clearSessionCookie(context: Context): void {
  context.cookies.delete({ name: SESSION_COOKIE, path: '/' });
}

const authJson = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/**
 * The gate every admin data route opens with: `null` means carry on, a
 * `Response` means stop and return it.
 *
 * The 401 body carries the reason ('expired' reads very differently from
 * 'bad-signature' when the owner is staring at a login card) but never says
 * whether a password exists or what it looks like.
 */
export function requireAdmin(context: Context): Response | null {
  const env = readAdminEnv();
  if (!env) {
    return authJson(
      {
        error: 'admin_not_configured',
        message: 'ADMIN_PASSWORD and ADMIN_SESSION_SECRET are not set on this deploy.',
      },
      503
    );
  }

  const result = verifySession(env.secret, readSessionCookie(context));
  if (result.ok === false) {
    return authJson({ error: 'unauthorized', message: result.reason }, 401);
  }
  return null;
}
