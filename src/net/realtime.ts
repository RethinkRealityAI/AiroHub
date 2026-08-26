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
  | 'connection';

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
        // Motion frames are the high-rate stream. The client library's default
        // of 10 events/sec would throttle aiming into a slideshow.
        params: { eventsPerSecond: 50 },
      },
    });
  }
  return client;
}

export function isRealtimeConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export class AiroConnection {
  private channel: RealtimeChannel | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private meta: PresenceMeta;
  private roomId: string;
  private closed = false;

  /** Latest derived roster, kept so `slotOf` is cheap during render. */
  private roster: PlayerInfo[] = [];
  /** Fires if the channel never reaches SUBSCRIBED, so the UI can stop spinning. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(roomId: string, meta: Omit<PresenceMeta, 'joinedAt'>) {
    this.roomId = roomId;
    this.meta = { ...meta, joinedAt: Date.now() };
  }

  get selfId(): string {
    return this.meta.id;
  }

  connect(): this {
    const supabase = getClient();
    if (!supabase) {
      // Without credentials the app still runs as a solo studio; surface that
      // rather than throwing so the 3D stage keeps working.
      queueMicrotask(() => this.dispatch('connection', { status: 'unconfigured' }));
      return this;
    }

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

    // Without this the UI sits on "Connecting…" indefinitely when the socket
    // can never be established (blocked network, offline device).
    this.connectTimer = setTimeout(() => {
      if (!this.closed) this.dispatch('connection', { status: 'error' });
    }, 9000);

    channel.subscribe(async (status) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') {
        this.clearConnectTimer();
        try {
          await channel.track(this.meta);
        } catch (err) {
          console.error('[realtime] presence track failed', err);
        }
        this.dispatch('connection', { status: 'connected' });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.clearConnectTimer();
        this.dispatch('connection', { status: 'error' });
      } else if (status === 'CLOSED') {
        this.dispatch('connection', { status: 'disconnected' });
      }
    });

    return this;
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

  /** Updates our own presence record (name/tool/mode changes). */
  async updatePresence(patch: Partial<Omit<PresenceMeta, 'id' | 'joinedAt'>>) {
    this.meta = { ...this.meta, ...patch };
    if (!this.channel) return;
    // A dropped socket must not surface as an unhandled rejection.
    try {
      await this.channel.track(this.meta);
    } catch (err) {
      console.error('[realtime] presence update failed', err);
    }
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
    this.handlers.clear();
    if (this.channel) {
      void this.channel.unsubscribe();
      this.channel = null;
    }
  }
}
