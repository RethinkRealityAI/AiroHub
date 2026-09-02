/**
 * `POST /api/admin/auth/login` — the only way to get an admin session.
 *
 * Its own file because Netlify's rate limits are configured per function: the
 * session probe runs on every dashboard load and must not share a 5-per-minute
 * budget with the password form. Five attempts per minute per IP is the actual
 * defence here, since a shared password has no lockout and no second factor;
 * the constant-time compare only removes the timing side channel.
 *
 * The comparison ALWAYS runs, even for a missing or absurd field. Returning
 * early on "no password supplied" makes the empty-body response measurably
 * faster than a wrong-password one, which tells an attacker their request shape
 * is right before they have guessed anything.
 */
import type { Config, Context } from '@netlify/functions';
import type { AdminSessionResponse } from '../../src/api/contracts.js';
import { constantTimeEqual, createSession, readAdminEnv, setSessionCookie } from './lib/auth.js';
import { json } from './lib/db.js';

/** Long enough for any real password, short enough that nobody hashes a novel. */
const PASSWORD_MAX = 512;

export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const env = readAdminEnv();
  if (!env) {
    return json(
      {
        error: 'admin_not_configured',
        message: 'ADMIN_PASSWORD and ADMIN_SESSION_SECRET are not set on this deploy.',
      },
      503
    );
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    submitted = String(body?.password ?? '').slice(0, PASSWORD_MAX);
  } catch {
    // A malformed body is a wrong password, not a different answer: it takes
    // the same path below and gets the same 401 after the same comparison.
  }

  if (!constantTimeEqual(submitted, env.password)) {
    return json({ error: 'invalid_password' }, 401);
  }

  const { token, expiresAt } = createSession(env.secret);
  setSessionCookie(context, token, expiresAt);

  const body: AdminSessionResponse = { authenticated: true, expiresAt };
  return json(body, 200);
};

export const config: Config = {
  path: '/api/admin/auth/login',
  method: 'POST',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
