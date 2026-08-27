/**
 * Realtime transport.
 *
 * The studio and the phone controllers used to talk through a socket.io server
 * bundled with the Express app. Netlify has no long-lived WebSocket process to
 * run that on, so the transport now rides Supabase Realtime broadcast channels
 * instead — pure client-to-client pub/sub with no backend of our own.
 *
 * The surface deliberately mirrors the socket.io API (`emit` / `on` / `off` /
 * `disconnect`) so call sites read the same as before.
 *
 * Room membership and player slots come from Realtime *presence* rather than a
 * server-side registry: every peer sees the same presence map, sorts it the
 * same way, and therefore derives the same slot numbers without anyone needing
 * to be the authority.
 */
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { PlayerInfo } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const MAX_PLAYERS = 4;

/** Colour assigned to each player slot, in slot order. */
export const SLOT_COLORS = ['#FF4D1C', '#22D3EE', '#A78BFA', '#34D399'];

export type AiroEvent =
  | 'motion'
  | 'action'
  | 'paint-stamps'
  | 'image-stamp'
  | 'undo-stroke'
  | 'redo-stroke'
  | 'camera-sync'
  | 'request-state'
  | 'canvas-state'
  | 'change-object'
  | 'settings'
  | 'clear-canvas'
  | 'shake'
  | 'calibrate'
  | 'ai-stamp'
  | 'player-list-update'
  | 'player-assigned'
  | 'connection'
  /** Local-only: the channel came back after a drop. Never leaves this peer. */
  | 'rejoined';

type Handler = (payload: any) => void;

export interface PresenceMeta {
  id: string;
  role: 'canvas' | 'controller';
  name: string;
  tool: 'spray' | 'brush';
  mode: 'motion' | 'projection';
  /** Client clock at join. Only used as a stable sort key, never as a deadline. */
  joinedAt: number;
}

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        // Client-side send budget for the whole socket, not per event type.
        // A single painting motion-mode phone already costs ~16 stamp batches/s
        // (StampBatcher flushes every 60ms) on top of 40Hz motion, and camera
        // sync rides the same socket; four of those blow straight through the
        // library's 10/s default and even through 50/s, and the overflow is
        // dropped silently — which is what the room sees as lag and desync.
        params: { eventsPerSecond: 200 },
      },
    });
  }
  return client;
}

export function isRealtimeConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Rejoin backoff in ms, indexed by attempt; the last entry repeats for as long
 * as the room stays open. A phone that locked its screen or hopped from wifi to
 * cellular is back inside a couple of seconds, while a venue whose uplink is
 * down keeps a 15s heartbeat instead of the room dying until someone reloads.
 */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
/** ±25%, so four phones that dropped together do not resubscribe on one tick. */
const BACKOFF_JITTER = 0.25;
/** Attempts made at the quick interval before falling back to the slow one. */
const PRESENCE_QUICK_RETRIES = 3;
const PRESENCE_RETRY_QUICK_MS = 300;
const PRESENCE_RETRY_SLOW_MS = 5000;

export interface AiroConnectionOptions {
  /**
   * Scales every reconnect and presence-retry delay. Only the automated suite
   * sets it, so a full drop-and-rejoin cycle runs in milliseconds; the app
   * leaves it at 1.
   */
  timeScale?: number;
}

export class AiroConnection {
  private channel: RealtimeChannel | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private meta: PresenceMeta;
  private roomId: string;
  private closed = false;
  private timeScale: number;

  /** Latest derived roster, kept so `slotOf` is cheap during render. */
  private roster: PlayerInfo[] = [];
  /** Fires if the channel never reaches SUBSCRIBED, so the UI can stop spinning. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive failed joins; indexes RECONNECT_BACKOFF_MS. */
  private attempt = 0;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  private trackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Distinguishes the first connect from every rejoin after it. */
  private everConnected = false;
  private wake: (() => void) | null = null;
  private onVisible: (() => void) | null = null;

  constructor(
    roomId: string,
    meta: Omit<PresenceMeta, 'joinedAt'>,
    options: AiroConnectionOptions = {}
  ) {
    this.roomId = roomId;
    this.meta = { ...meta, joinedAt: Date.now() };
    this.timeScale = options.timeScale ?? 1;
  }

  get selfId(): string {
    return this.meta.id;
  }

  connect(): this {
    if (!getClient()) {
      // Without credentials the app still runs as a solo studio; surface that
      // rather than throwing so the 3D stage keeps working.
      queueMicrotask(() => this.dispatch('connection', { status: 'unconfigured' }));
      return this;
    }

    this.bindWakeListeners();

    // Without this the UI sits on "Connecting…" indefinitely when the socket
    // can never be established (blocked network, offline device). Only the
    // first connect is timed: after that the room reports "reconnecting" and
    // keeps trying rather than declaring itself dead.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (!this.closed && !this.everConnected) this.dispatch('connection', { status: 'error' });
    }, 9000);

    this.join();
    return this;
  }

  /**
   * Subscribes a fresh channel. Used for the first connect and every rejoin so
   * the handler wiring can never drift between the two — a rejoined channel
   * that forgot to re-register `broadcast` handlers looks exactly like a peer
   * who went quiet.
   */
  private join() {
    const supabase = getClient();
    if (!supabase || this.closed) return;

    const channel = supabase.channel(`airohub:${this.roomId}`, {
      config: {
        presence: { key: this.meta.id },
        broadcast: { self: false, ack: false },
      },
    });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => this.recomputeRoster());

    const FORWARDED: AiroEvent[] = [
      'motion',
      'action',
      'paint-stamps',
      'image-stamp',
      'undo-stroke',
      'redo-stroke',
      'camera-sync',
      'request-state',
      'canvas-state',
      'change-object',
      'settings',
      'clear-canvas',
      'shake',
      'calibrate',
      'ai-stamp',
    ];
    for (const event of FORWARDED) {
      channel.on('broadcast', { event }, ({ payload }) => this.dispatch(event, payload));
    }

    channel.subscribe((status) => this.onStatus(channel, status));
  }

  private onStatus(channel: RealtimeChannel, status: string) {
    // Tearing a channel down makes the library report CLOSED on it; that is
    // our own doing, not a drop, so anything from a superseded channel is
    // ignored rather than triggering a second rejoin.
    if (this.closed || channel !== this.channel) return;

    if (status === 'SUBSCRIBED') {
      this.clearConnectTimer();
      this.attempt = 0;
      // Presence is what grants a player their slot in every peer's roster, so
      // it gets its own retry rather than a single best-effort attempt.
      this.trackPresence(channel);
      this.dispatch('connection', { status: 'connected' });
      if (this.everConnected) this.dispatch('rejoined', { roomId: this.roomId });
      this.everConnected = true;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      this.scheduleRejoin();
    }
  }

  private scheduleRejoin() {
    if (this.closed || this.rejoinTimer) return;
    // Only a room that was up can be "reconnecting". Before the first success
    // the 9s timer owns the story — a device that simply has no route to the
    // service settles on solo mode instead of a pill that spins forever, while
    // the retries keep running underneath and take it live if the route opens.
    if (this.everConnected) this.dispatch('connection', { status: 'reconnecting' });
    this.teardownChannel();
    const step = RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.attempt++;
    const delay = step * (1 + (Math.random() * 2 - 1) * BACKOFF_JITTER) * this.timeScale;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      this.join();
    }, delay);
  }

  /** Drops the current channel and the library's reference to it. */
  private teardownChannel() {
    const channel = this.channel;
    this.channel = null;
    this.clearTrackTimer();
    if (!channel) return;
    // A socket that is already gone rejects both of these; that is the normal
    // case here, so neither may surface as an unhandled rejection. Removing as
    // well as unsubscribing matters: a channel the client still holds keeps its
    // own rejoin timer running against a topic we have abandoned.
    void Promise.resolve(channel.unsubscribe()).catch(() => undefined);
    const supabase = getClient();
    if (supabase) void Promise.resolve(supabase.removeChannel(channel)).catch(() => undefined);
  }

  /**
   * Registers our presence record, retrying until it lands. A controller whose
   * `track` failed still broadcasts perfectly well but never appears in anyone
   * else's roster — the "I can see them spraying but there is no cursor" bug.
   */
  private trackPresence(channel: RealtimeChannel, attempt = 0) {
    if (this.closed || channel !== this.channel) return;
    this.clearTrackTimer();
    void Promise.resolve(channel.track(this.meta)).then(
      (result) => {
        // The library answers with a status string rather than throwing, so a
        // non-'ok' reply counts as a failure just as much as a rejection.
        if (result === undefined || result === 'ok') return;
        this.retryTrack(channel, attempt, String(result));
      },
      (err) => this.retryTrack(channel, attempt, String(err))
    );
  }

  private retryTrack(channel: RealtimeChannel, attempt: number, reason: string) {
    if (this.closed || channel !== this.channel) return;
    console.warn('[realtime] presence track failed, retrying', reason);
    const base = attempt < PRESENCE_QUICK_RETRIES ? PRESENCE_RETRY_QUICK_MS : PRESENCE_RETRY_SLOW_MS;
    this.trackTimer = setTimeout(() => {
      this.trackTimer = null;
      this.trackPresence(channel, attempt + 1);
    }, base * this.timeScale);
  }

  /**
   * Fast path back from a sleeping phone. A backgrounded tab's socket dies
   * without the status callback ever firing, so the wake itself is the signal:
   * if the channel is not up, rejoin now instead of waiting out the backoff.
   */
  private bindWakeListeners() {
    if (this.wake || typeof window === 'undefined') return;
    this.wake = () => {
      if (this.closed) return;
      const state = this.channel?.state;
      if (state === 'joined' || state === 'joining') return;
      this.attempt = 0;
      if (this.rejoinTimer) {
        clearTimeout(this.rejoinTimer);
        this.rejoinTimer = null;
      }
      if (this.everConnected) this.dispatch('connection', { status: 'reconnecting' });
      this.teardownChannel();
      this.join();
    };
    this.onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.wake?.();
    };
    window.addEventListener('online', this.wake);
    window.addEventListener('pageshow', this.wake);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible);
    }
  }

  private unbindWakeListeners() {
    if (typeof window !== 'undefined' && this.wake) {
      window.removeEventListener('online', this.wake);
      window.removeEventListener('pageshow', this.wake);
    }
    if (typeof document !== 'undefined' && this.onVisible) {
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.wake = null;
    this.onVisible = null;
  }

  /**
   * Derives the player roster from presence.
   *
   * Controllers are ordered by join time (id as tiebreak) so that every peer
   * independently computes identical slot numbers — no coordinator required.
   */
  private recomputeRoster() {
    if (!this.channel) return;
    const state = this.channel.presenceState<PresenceMeta>();

    const members: PresenceMeta[] = [];
    for (const key of Object.keys(state)) {
      const entry = state[key]?.[0];
      if (entry && entry.role) members.push(entry as unknown as PresenceMeta);
    }

    const controllers = members
      .filter((m) => m.role === 'controller')
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
      .slice(0, MAX_PLAYERS);

    this.roster = controllers.map((m, index) => ({
      id: m.id,
      slot: index + 1,
      name: m.name,
      color: SLOT_COLORS[index % SLOT_COLORS.length],
      tool: m.tool,
      mode: m.mode,
    }));

    this.dispatch('player-list-update', this.roster);

    const mine = this.roster.find((p) => p.id === this.meta.id);
    if (mine) this.dispatch('player-assigned', mine);
  }

  private clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearTrackTimer() {
    if (this.trackTimer) {
      clearTimeout(this.trackTimer);
      this.trackTimer = null;
    }
  }

  /** Updates our own presence record (name/tool/mode changes). */
  async updatePresence(patch: Partial<Omit<PresenceMeta, 'id' | 'joinedAt'>>) {
    this.meta = { ...this.meta, ...patch };
    if (!this.channel) return;
    // Shares the retry path: a rename that lost the race with a drop must not
    // leave this player carrying a stale record on every peer.
    this.trackPresence(this.channel);
  }

  emit(event: AiroEvent, payload: Record<string, unknown> = {}) {
    if (!this.channel || this.closed) return;
    // Fire-and-forget: an awaited send would stall the animation frame that
    // produced this motion sample. Swallow transport errors — a dropped frame
    // of motion data is not worth an unhandled rejection.
    void Promise.resolve(this.channel.send({ type: 'broadcast', event, payload })).catch(() => undefined);
  }

  on(event: AiroEvent, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  off(event: AiroEvent, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }

  private dispatch(event: string, payload: any) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[realtime] handler for "${event}" threw`, err);
      }
    }
  }

  /**
   * Dispatches an event locally as if it had arrived from the network.
   * Exists for automated end-to-end tests in environments whose sandboxes
   * block WebSockets; it exercises the identical handler path.
   */
  simulateIncoming(event: AiroEvent, payload: unknown) {
    this.dispatch(event, payload);
  }

  disconnect() {
    this.closed = true;
    this.clearConnectTimer();
    this.clearTrackTimer();
    if (this.rejoinTimer) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    this.unbindWakeListeners();
    this.handlers.clear();
    this.teardownChannel();
  }
}
