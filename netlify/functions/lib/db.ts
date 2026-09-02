/**
 * Database access for the launch endpoints.
 *
 * Netlify Database is serverless Postgres that goes to sleep on inactivity and
 * wakes on the next connection. A sleeping or unreachable database is a normal
 * operating state here, not an exception, and the whole point of this module is
 * that a page still renders when it happens. Two rules follow:
 *
 *  - `isDbConfigured()` is checked before anything touches `getDb()`. Deploy
 *    previews and local `netlify dev` runs without `NETLIFY_DB_URL` would
 *    otherwise throw a connection error on module load and turn every endpoint
 *    into a 502 with no useful message.
 *  - `safeQuery()` turns a failed query into its declared fallback plus a log
 *    line. The dashboard renders an empty panel instead of a blank page, and
 *    `/api/flags` serves defaults instead of stalling first paint behind a
 *    5xx that the client has no way to recover from.
 *
 * `getDb()` is memoised per warm instance because `getDatabase()` builds a
 * connection pool: doing that per request is how a serverless function
 * exhausts a Postgres connection limit under any real traffic.
 */
import { getDatabase, type DatabaseConnection } from '@netlify/database';

/**
 * Netlify injects `NETLIFY_DB_URL` when a database is attached to the site. No
 * variable means no database, which is a degraded-but-fine state, not an error.
 */
export const isDbConfigured = (): boolean => Boolean(process.env.NETLIFY_DB_URL);

let connection: DatabaseConnection | null = null;

/** The shared connection for this warm instance. Call only behind `isDbConfigured()`. */
export function getDb(): DatabaseConnection {
  if (!connection) connection = getDatabase();
  return connection;
}

/**
 * JSON response helper. `no-store` is the default because every endpoint here
 * except `/api/flags` is either personalised (admin) or a write; a caching
 * proxy that decided otherwise would serve one visitor's dashboard to another.
 */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** The one 503 shape the admin client knows how to explain to a human. */
export function dbUnavailable(): Response {
  return json(
    {
      error: 'database_unavailable',
      message: 'The database is not reachable right now. Try again in a moment.',
    },
    503
  );
}

/**
 * Run a query, or return `fallback` and log why. Used for every read whose
 * absence should degrade one panel rather than fail a whole response.
 */
export async function safeQuery<T>(run: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[db] ${label} failed`, error);
    return fallback;
  }
}
