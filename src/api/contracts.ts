/**
 * The contract between the browser and the Netlify functions.
 *
 * Imported by both sides — `src/**` through the Vite bundle and
 * `netlify/functions/**` through Netlify's own bundler — so this file has to
 * stay portable: types and frozen constants only. No imports, no
 * `import.meta.env`, no DOM types, no JSX. Anything that depends on a runtime
 * belongs next to the code that runs there.
 *
 * Why one file: every launch feature (flags, analytics, feedback, admin) is a
 * pair of a producer and a consumer that can drift apart silently. A shared
 * event-name allowlist means a typo in a `track()` call is a type error in the
 * client AND a dropped row on the server, never a phantom event in the
 * dashboard.
 */

/* ------------------------------------------------------------------ flags */

export interface UiFlags {
  /** The AI copilot button and sheet in the studio. */
  aiPanel: boolean;
  /** The flat-trackpad "Pad" option in the phone's mode switch. */
  padMode: boolean;
  /** Stamp mode in the studio and on the phone. */
  stamps: boolean;
  /** The turntable showcase recorder. */
  showcase: boolean;
  /** Uploading your own model from the studio's object picker. */
  uploads: boolean;
  /** The floating feedback button on every screen. */
  feedbackButton: boolean;
}

export interface Flags {
  ui: UiFlags;
  /** A short banner shown in the studio; empty hides it. */
  notice: string;
  ai: {
    /** Gemini calls allowed per UTC day before the copilot degrades to curated answers. */
    dailyCap: number;
  };
}

/** What `GET /api/flags` returns — never the AI budget. */
export type PublicFlags = Pick<Flags, 'ui' | 'notice'>;

/**
 * The launch posture. AI and Pad are off by default: the three spray modes
 * are the product, and both of these are things the owner turns on from the
 * dashboard when they want them.
 */
export const DEFAULT_FLAGS: Flags = {
  ui: {
    aiPanel: false,
    padMode: false,
    stamps: true,
    showcase: true,
    uploads: true,
    feedbackButton: true,
  },
  notice: '',
  ai: { dailyCap: 500 },
};

export const PUBLIC_FLAG_KEYS = ['ui', 'notice'] as const;
export const NOTICE_MAX = 280;
export const AI_DAILY_CAP_MAX = 100000;

/* -------------------------------------------------------------- analytics */

export type EventName =
  | 'page_view'
  | 'notfound'
  | 'studio.create'
  | 'studio.join'
  | 'room.enter'
  | 'controller.mode'
  | 'paint.first'
  | 'object.change'
  | 'stamp.place'
  | 'invite.open'
  | 'invite.copy'
  | 'snapshot.save'
  | 'showcase.record'
  | 'ai.open'
  | 'ai.run'
  | 'feedback.open'
  | 'feedback.submit'
  | 'guide.open'
  | 'client.error';

/** The allowlist the server enforces; anything else is dropped, not stored. */
export const EVENT_NAMES: readonly EventName[] = [
  'page_view',
  'notfound',
  'studio.create',
  'studio.join',
  'room.enter',
  'controller.mode',
  'paint.first',
  'object.change',
  'stamp.place',
  'invite.open',
  'invite.copy',
  'snapshot.save',
  'showcase.record',
  'ai.open',
  'ai.run',
  'feedback.open',
  'feedback.submit',
  'guide.open',
  'client.error',
];

export const TRACK_MAX_BATCH = 20;
export const TRACK_MAX_PROPS_BYTES = 2048;
export const TRACK_MAX_BODY_BYTES = 64 * 1024;

export interface TrackEvent {
  name: EventName;
  /** The client's `location.pathname`; the server normalises room codes away. */
  path?: string;
  roomId?: string;
  props?: Record<string, unknown>;
}

export interface TrackRequest {
  /** Per-tab, from sessionStorage. Not a cookie, not persistent. */
  sessionId: string;
  /** Only on the first batch of a session; parsed to a host and discarded. */
  referrer?: string;
  events: TrackEvent[];
}

export interface TrackResponse {
  accepted: number;
  dropped: number;
}

export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';

/** One stored event, as the admin dashboard reads it back. */
export interface EventRow {
  occurred_at: string;
  name: EventName;
  path: string;
  room_id: string;
  referrer_host: string;
  device: Device;
  country: string;
  props: Record<string, unknown>;
}

/* --------------------------------------------------------------- feedback */

export type FeedbackKind = 'feedback' | 'suggestion' | 'bug';
export type FeedbackStatus = 'new' | 'read' | 'resolved';

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['feedback', 'suggestion', 'bug'];
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['new', 'read', 'resolved'];
export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 2000;
export const FEEDBACK_EMAIL_MAX = 160;
export const FEEDBACK_NOTE_MAX = 2000;

export interface FeedbackRequest {
  kind: FeedbackKind;
  message: string;
  email?: string;
  path?: string;
  roomId?: string;
  /**
   * Honeypot. Hidden from people, filled by bots. Any non-empty value is
   * accepted with a 200 and silently discarded.
   */
  website?: string;
}

export interface FeedbackRow {
  id: number;
  created_at: string;
  kind: FeedbackKind;
  message: string;
  email: string;
  path: string;
  room_id: string;
  user_agent: string;
  country: string;
  status: FeedbackStatus;
  admin_note: string;
  updated_at: string;
}

export interface FeedbackUpdateRequest {
  id: number;
  status?: FeedbackStatus;
  adminNote?: string;
}

/* ------------------------------------------------------------------ admin */

export interface AdminSessionResponse {
  authenticated: boolean;
  /** Epoch milliseconds; present only when authenticated. */
  expiresAt?: number;
}

export interface AdminLoginRequest {
  password: string;
}

export interface DailyPoint {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  views: number;
  /**
   * Distinct visitors that day. The identifier is re-salted at midnight UTC,
   * so this is only meaningful per day — summing the column gives visitor-days.
   */
  visitors: number;
  rooms: number;
}

export interface Ranked {
  key: string;
  hits: number;
  sessions: number;
}

export interface OverviewResponse {
  days: number;
  daily: DailyPoint[];
  today: {
    views: number;
    visitors: number;
    rooms: number;
    errors: number;
  };
  referrers: Ranked[];
  pages: Ranked[];
  devices: Ranked[];
  countries: Ranked[];
  recent: EventRow[];
  aiCallsToday: number;
  feedbackCounts: Record<FeedbackStatus, number>;
}

export interface ApiError {
  error: string;
  message?: string;
}
