/**
 * Turning `settings` rows into a `Flags` object the rest of the code can trust.
 *
 * The rows are jsonb written by the admin dashboard, so in principle they are
 * whatever the last POST said — including a shape from a previous version of
 * the dashboard, a half-applied edit, or a hand-run SQL statement. Nothing
 * downstream re-checks them: `flags.ui.aiPanel` decides whether a button
 * exists, and `flags.ai.dailyCap` is compared against a counter with `>`. A
 * string `"false"` is truthy and would turn the AI panel on for everybody; a
 * cap of `"none"` makes every comparison false and uncaps the spend. So this
 * module never spreads a stored object into the result. It walks the known
 * fields, coerces each one by type, clamps the numbers, and drops everything it
 * does not recognise — the stored value is a suggestion, the defaults are the
 * shape.
 *
 * `publicSubset` exists for the same reason in the other direction: the browser
 * gets `ui` and `notice` and must never receive `ai`, because the daily budget
 * is an operational number, and publishing it tells a visitor exactly how many
 * requests it takes to exhaust the launch's AI spend.
 */
import {
  AI_DAILY_CAP_MAX,
  DEFAULT_FLAGS,
  NOTICE_MAX,
  type Flags,
  type PublicFlags,
  type UiFlags,
} from '../../../src/api/contracts.js';

/** One row of the `settings` table, as read back from Postgres. */
export interface SettingRow {
  key: string;
  value: unknown;
}

const UI_KEYS = Object.keys(DEFAULT_FLAGS.ui) as (keyof UiFlags)[];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Deep-merge stored settings over the compiled-in defaults. Rows are applied in
 * the order given, so a caller can append a pending patch after the current
 * rows and read back exactly what would be stored.
 */
export function mergeFlags(rows: readonly SettingRow[] | null | undefined): Flags {
  const flags: Flags = {
    ui: { ...DEFAULT_FLAGS.ui },
    notice: DEFAULT_FLAGS.notice,
    ai: { ...DEFAULT_FLAGS.ai },
  };

  for (const row of rows ?? []) {
    if (!row || typeof row.key !== 'string') continue;

    if (row.key === 'ui' && isPlainObject(row.value)) {
      for (const key of UI_KEYS) {
        const value = row.value[key];
        // Booleans only. `"false"`, `0` and `null` are all rejected rather than
        // coerced, because every one of them would silently flip a feature.
        if (typeof value === 'boolean') flags.ui[key] = value;
      }
      continue;
    }

    if (row.key === 'notice' && typeof row.value === 'string') {
      flags.notice = row.value.slice(0, NOTICE_MAX);
      continue;
    }

    if (row.key === 'ai' && isPlainObject(row.value)) {
      const cap = row.value.dailyCap;
      if (typeof cap === 'number' && Number.isFinite(cap)) {
        flags.ai.dailyCap = Math.min(AI_DAILY_CAP_MAX, Math.max(0, Math.trunc(cap)));
      }
    }
    // Any other key in the table is ignored: unknown settings are not flags.
  }

  return flags;
}

/** Exactly what `GET /api/flags` may say. New object, so no `ai` can ride along. */
export function publicSubset(flags: Flags): PublicFlags {
  return {
    ui: {
      aiPanel: flags.ui.aiPanel,
      padMode: flags.ui.padMode,
      stamps: flags.ui.stamps,
      showcase: flags.ui.showcase,
      uploads: flags.ui.uploads,
      feedbackButton: flags.ui.feedbackButton,
    },
    notice: flags.notice,
  };
}

/** The top-level keys the admin dashboard is allowed to write. */
export const FLAG_KEYS = ['ui', 'notice', 'ai'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
