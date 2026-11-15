import type { ChatEvent } from "@particle-academy/fancy-chat-js";

export function ev(seq: number, type: string, data: Record<string, unknown> = {}, extra: Partial<ChatEvent> = {}): ChatEvent {
  return {
    v: 1,
    seq,
    threadId: "t_1",
    at: "2026-11-15T10:00:00.000Z",
    type,
    actor: { kind: "agent", id: "compass" },
    data,
    ...extra,
  } as ChatEvent;
}

/** A message created then streamed: seq n..n+3. */
export function streamedMessage(start: number, id: string, chunks: string[]): ChatEvent[] {
  const out: ChatEvent[] = [ev(start, "message.created", { message: { id, role: "assistant", parts: [] } })];
  out.push(ev(start + 1, "part.started", { messageId: id, part: { id: "p", kind: "text", format: "markdown", text: chunks[0] ?? "" } }));
  let seq = start + 2;
  for (const chunk of chunks.slice(1)) out.push(ev(seq++, "part.delta", { messageId: id, partId: "p", text: chunk }));
  out.push(ev(seq, "part.completed", { messageId: id, partId: "p" }));
  return out;
}

/** A controllable EventSource double. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  emit(events: ChatEvent | ChatEvent[]) {
    const list = Array.isArray(events) ? events : [events];
    for (const e of list) this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(e), lastEventId: String(e.seq) }));
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  static reset() {
    FakeEventSource.instances = [];
  }
  static last(): FakeEventSource {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!es) throw new Error("no EventSource opened");
    return es;
  }
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
