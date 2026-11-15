import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "@particle-academy/fancy-chat-js";

import { createHttpTransport, createThreadStore, type ThreadStore } from "../../src/index";

/*
 * The UI transport and store against the real Laravel server. fancy-chat-php's
 * harness runs a scripted turn inside POST messages: thinking, a tool call and
 * its result, an assistant message streamed in three deltas, then an approval
 * (`yes` allow-once, `no` reject-once) that parks the turn. Approving applies a
 * staged write that opens an undo window, and the turn ends with "Sent.".
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const phpDir = resolve(process.env.FANCY_CHAT_PHP_DIR ?? join(here, "../../../fancy-chat-php"));
const router = join(phpDir, "tests/e2e/serve.php");

let server: ChildProcess | null = null;
let base = "";
let dbDir = "";

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      s.close(() => (typeof address === "object" && address ? ok(address.port) : fail(new Error("no port"))));
    });
  });
}

async function until<T>(what: string, probe: () => T | null | undefined | false, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const user = { "X-E2E-User": "u_e2e" };

function client(threadId: string, mode: "poll" | "sse"): { store: ThreadStore; transport: ReturnType<typeof createHttpTransport> } {
  const transport = createHttpTransport({
    baseUrl: `${base}/fancy-chat`,
    threadId,
    mode,
    headers: () => user,
    pollWaitMs: 1000,
    minPollGapMs: 20,
    retryMs: 50,
  });
  const store = createThreadStore({ transport });
  store.start();
  return { store, transport };
}

const kinds = (rows: Row[]) => rows.map((r) => r.kind);
const textOf = (rows: Row[]) =>
  rows
    .filter((r): r is Extract<Row, { kind: "message" }> => r.kind === "message")
    .map((m) => m.parts.map((p) => String(p.text ?? "")).join(""));

beforeAll(async () => {
  // Fail, never skip: a green e2e run must mean the server actually ran.
  if (!existsSync(router)) throw new Error(`fancy-chat-php harness not found at ${router}; set FANCY_CHAT_PHP_DIR`);
  dbDir = mkdtempSync(join(tmpdir(), "fancy-chat-e2e-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn("php", ["-S", `127.0.0.1:${port}`, router], {
    cwd: phpDir,
    env: { ...process.env, FANCY_CHAT_E2E_DB: join(dbDir, "e2e.sqlite"), FANCY_CHAT_E2E_TYPED: "1", FANCY_CHAT_E2E_SSE_MS: "1000", FANCY_CHAT_E2E_POLL_MS: "800", FANCY_CHAT_E2E_UNDO_MS: "30000" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/fancy-chat/threads/boot/events/poll?after=0&wait=0`, { headers: user });
      if (r.status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("php -S never answered");
    await new Promise((r) => setTimeout(r, 100));
  }
});

afterAll(() => {
  server?.kill();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

describe("the UI transport against fancy-chat-php", () => {
  it("refuses a request with no human actor", async () => {
    const r = await fetch(`${base}/fancy-chat/threads/t_x/events/poll?after=0&wait=0`);
    expect(r.status).toBe(401);
  });

  it("long-poll: a full turn projects in the browser exactly as streamed, then parks on the approval", async () => {
    const { store, transport } = client("t_poll", "poll");
    const sent = await transport.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Send the update" }] });
    expect(sent.delivery).toBeTruthy();
    const snap = await until("the approval", () => {
      const s = store.getSnapshot();
      return s.state.approvals.find((a) => a.state === "pending") ? s : null;
    });
    expect(kinds(snap.rows)).toEqual(expect.arrayContaining(["message", "thinking", "tool", "approval"]));
    expect(textOf(snap.rows)[0]).toBe("Send the update");
    expect(snap.state.illegal).toBe(0);
    expect(snap.missing).toBeNull();

    // A second client replaying from zero lands on the identical projection.
    const fresh = client("t_poll", "poll");
    await until("the replay", () => fresh.store.getSnapshot().lastSeq >= snap.lastSeq);
    expect(fresh.store.getSnapshot().rows.slice(0, snap.rows.length)).toEqual(snap.rows);
    fresh.store.stop();
    store.stop();
  });

  it("the human's decision applies the write, opens an undo window, and the revert lands", async () => {
    const { store, transport } = client("t_decide", "poll");
    await transport.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Go" }] });
    const approval = await until("the approval", () => store.getSnapshot().state.approvals.find((a) => a.state === "pending"));
    await transport.decide(approval.approvalId, { optionId: "yes" });
    const undo = await until("the undo window", () => store.getSnapshot().state.undos.find((u) => u.state === "open"));
    await until("applied", () => store.getSnapshot().state.approvals.find((a) => a.approvalId === approval.approvalId && a.state === "applied"));
    await until("the turn's end", () => textOf(store.getSnapshot().rows).includes("Sent."));
    await transport.revertUndo(undo.actionId);
    await until("the revert", () => store.getSnapshot().state.undos.find((u) => u.actionId === undo.actionId && u.state === "reverted"));
    store.stop();
  });

  it("typed approval: 'approve' is taken as the decision, never sent to the agent", async () => {
    const { store, transport } = client("t_typed", "poll");
    await transport.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Go" }] });
    const approval = await until("the approval", () => store.getSnapshot().state.approvals.find((a) => a.state === "pending"));
    const typed = await transport.send({ parts: [{ id: "p2", kind: "text", format: "plain", text: "Approve." }] });
    expect(typed.typedDecision).toMatchObject({ approvalId: approval.approvalId, optionId: "yes", decision: "approve" });
    await until("applied", () => store.getSnapshot().state.approvals.find((a) => a.approvalId === approval.approvalId && a.state === "applied"));
    store.stop();
  });

  it("an empty body cannot decide for anyone: the actor comes only from the server's resolver", async () => {
    const { store, transport } = client("t_actor", "poll");
    await transport.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Go" }] });
    const approval = await until("the approval", () => store.getSnapshot().state.approvals.find((a) => a.state === "pending"));
    const r = await fetch(`${base}/fancy-chat/approvals/${approval.approvalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: "yes", actor: { kind: "human", id: "u_e2e" } }),
    });
    expect(r.status).toBe(401);
    expect(store.getSnapshot().state.approvals.find((a) => a.approvalId === approval.approvalId)?.state).toBe("pending");
    store.stop();
  });

  it("SSE and long-poll yield the same stream", async () => {
    const { store, transport } = client("t_sse", "poll");
    await transport.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Stream me" }] });
    const polled = await until("the approval", () => {
      const s = store.getSnapshot();
      return s.state.approvals.length ? s : null;
    });
    store.stop();
    // The harness authenticates by header, which EventSource cannot send (a
    // browser sends cookies instead). So this reads the SSE response over fetch
    // and checks the framing EventSource parses: one id and one data line per
    // event, gapless from 1, the same events the long-poll leg projected.
    const res = await fetch(`${base}/fancy-chat/threads/t_sse/events?after=0`, { headers: { ...user, Accept: "text/event-stream" } });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const body = await res.text();
    const events = body
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => !!line)
      .map((line) => JSON.parse(line.slice(6)) as { seq: number });
    const ids = body.split("\n").filter((l) => l.startsWith("id: ")).map((l) => Number(l.slice(4)));
    expect(events.map((e) => e.seq)).toEqual(ids);
    expect(events.length).toBe(polled.lastSeq);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: polled.lastSeq }, (_, i) => i + 1));
  });
});
