/**
 * `GET /api/admin/auth/session` and `POST /api/admin/auth/logout`.
 *
 * Separate from `admin-login.mts` on purpose. Rate limits are per function, and
 * the dashboard probes the session on every load and after every 401; sharing
 * the login's 5-per-minute budget would lock the owner out of their own
 * dashboard by refreshing it. Neither route here is a guessing target — the
 * probe reveals nothing an attacker does not already know about their own
 * cookie — so this file carries no rate limit at all.
 *
 * The probe ALWAYS answers 200. `{ authenticated: false }` is the answer to
 * "am I signed in?", not an error; returning 401 here would make the gate's own
 * bootstrap request trip the client's global 401 handler and loop.
 */
import type { Config, Context } from '@netlify/functions';
import type { AdminSessionResponse } from '../../src/api/contracts.js';
import { clearSessionCookie, readAdminEnv, readSessionCookie, verifySession } from './_auth.js';
import { json } from './_db.js';

export default async (request: Request, context: Context): Promise<Response> => {
  const path = new URL(request.url).pathname;

  if (path.endsWith('/logout')) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    // Unconditional: logging out of a session that was already invalid is a
    // success, and the cookie is cleared either way.
    clearSessionCookie(context);
    const body: AdminSessionResponse = { authenticated: false };
    return json(body, 200);
  }

  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const env = readAdminEnv();
  // No admin configured is indistinguishable from not signed in, deliberately:
  // the probe is public, and whether this deploy has a password set is not.
  if (!env) return json({ authenticated: false } satisfies AdminSessionResponse, 200);

  const result = verifySession(env.secret, readSessionCookie(context));
  if (result.ok === true) {
    const body: AdminSessionResponse = { authenticated: true, expiresAt: result.expiresAt };
    return json(body, 200);
  }

  return json({ authenticated: false } satisfies AdminSessionResponse, 200);
};

export const config: Config = {
  path: ['/api/admin/auth/session', '/api/admin/auth/logout'],
};
