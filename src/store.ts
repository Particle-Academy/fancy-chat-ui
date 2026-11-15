import {
  applyEvent,
  createSeqLog,
  emptyThreadState,
  ingestEvents,
  rowsOf,
  type ChatEvent,
  type Gap,
  type Row,
  type SeqLog,
  type ThreadState,
} from "@particle-academy/fancy-chat-js";

import type { ChatTransport, ConnectionState, TransportMode } from "./transport";

export interface ThreadSnapshot {
  state: ThreadState;
  rows: Row[];
  lastSeq: number;
  /** Bumped on every change; cheap equality for memoised consumers. */
  version: number;
  connection: ConnectionState;
  mode: TransportMode | null;
  /** A gap being repaired, if any. */
  missing: Gap | null;
  /** Events this client refused (illegal per the contract, or a cancelled turn's tail). Diagnostics. */
  dropped: number;
  error: unknown;
}

export interface ThreadStoreOptions {
  transport: ChatTransport;
  /** Resume from a snapshot the host already has (SSR, cache). */
  initial?: ThreadState;
  /**
   * An OPTIONAL "something new" hint (Laravel Echo / Reverb): call `cb(seq)` when
   * the server says the thread reached `seq`. It only triggers a fetch; a missed
   * nudge costs nothing because SSE or long-poll carries every event anyway.
   */
  nudge?: (cb: (seq: number) => void) => () => void;
}

export interface ThreadStore {
  /** Start, or join a running store. Every start needs its stop; the last stop disconnects. */
  start(): void;
  stop(): void;
  getSnapshot(): ThreadSnapshot;
  subscribe(listener: () => void): () => void;
  /** Apply events from any source (an optimistic echo, a test). Deduped by seq. */
  ingest(events: ChatEvent[]): void;
}

const ABANDONED = new Set(["cancelled", "interrupted"]);
const TURN_EVENTS = new Set(["turn.started", "turn.transition", "turn.settled"]);

export function createThreadStore(options: ThreadStoreOptions): ThreadStore {
  const state: ThreadState = options.initial ? (JSON.parse(JSON.stringify(options.initial)) as ThreadState) : emptyThreadState();
  let log: SeqLog = createSeqLog(state.lastSeq);
  let snapshot: ThreadSnapshot = {
    state,
    rows: rowsOf(state),
    lastSeq: state.lastSeq,
    version: 0,
    connection: "closed",
    mode: null,
    missing: null,
    dropped: 0,
    error: null,
  };
  const listeners = new Set<() => void>();
  let stopSub: (() => void) | null = null;
  let stopNudge: (() => void) | null = null;
  let repairing = false;
  let running = false;
  let users = 0;

  const publish = (patch: Partial<ThreadSnapshot>, changedRows: boolean) => {
    snapshot = {
      ...snapshot,
      ...patch,
      ...(changedRows ? { rows: rowsOf(state), lastSeq: state.lastSeq } : {}),
      version: snapshot.version + 1,
    };
    for (const l of [...listeners]) l();
  };

  /** A cancelled or interrupted turn's late events are dropped by turnId, never by timing. */
  const abandoned = (event: ChatEvent): boolean => {
    if (TURN_EVENTS.has(event.type)) return false;
    const turnId = event.turnId ?? (typeof event.data?.turnId === "string" ? (event.data.turnId as string) : null);
    if (!turnId) return false;
    const turn = state.turns.find((t) => t.turnId === turnId);
    return !!turn && turn.state === "settled" && turn.outcome !== null && ABANDONED.has(turn.outcome);
  };

  const repair = async (gap: Gap) => {
    if (repairing || !running) return;
    repairing = true;
    try {
      const r = await options.transport.fetchAfter(gap.after);
      repairing = false;
      if (running) ingest(r.events ?? []);
    } catch (error) {
      repairing = false;
      publish({ error }, false);
    }
  };

  function ingest(events: ChatEvent[]) {
    const r = ingestEvents(log, events);
    log = r.log;
    let dropped = 0;
    for (const event of r.applied) {
      if (abandoned(event)) {
        state.lastSeq = event.seq;
        dropped += 1;
        continue;
      }
      const before = state.illegal;
      applyEvent(state, event);
      dropped += state.illegal - before;
    }
    const changed = r.applied.length > 0;
    const missingChanged = (r.missing?.after ?? null) !== (snapshot.missing?.after ?? null) || (r.missing?.before ?? null) !== (snapshot.missing?.before ?? null);
    if (changed || missingChanged) publish({ missing: r.missing, dropped: snapshot.dropped + dropped }, changed);
    if (r.missing) void repair(r.missing);
  }

  return {
    start() {
      users += 1;
      if (running) return;
      running = true;
      stopSub = options.transport.subscribe({
        after: () => log.lastSeq,
        onEvents: ingest,
        onMode: (mode) => publish({ mode }, false),
        onConnection: (connection) => publish({ connection }, false),
        onError: (error) => publish({ error }, false),
        // A turn in flight: what interval mode polls for. A parked turn waits on a
        // human, whose action wakes the transport, so it does not count.
        active: () => state.turns.some((t) => t.state === "pending" || t.state === "running" || t.state === "cancelling"),
      });
      stopNudge =
        options.nudge?.((seq) => {
          if (seq > log.lastSeq && running) void repair({ after: log.lastSeq, before: seq });
        }) ?? null;
    },
    stop() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      running = false;
      stopSub?.();
      stopNudge?.();
      stopSub = null;
      stopNudge = null;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ingest,
  };
}
