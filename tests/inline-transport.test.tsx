import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAgentThread, type ChatTransport } from "../src/index";
import { flush } from "./helpers";

// The README builds the transport in a useMemo, but a host (or a test) can build
// it inline, one per render. Recording the send outcome re-renders the hook after
// a send; with the capabilities reset that used to run in an effect on every
// transport change, that one re-render became an endless loop.
const inline = (): ChatTransport =>
  ({
    subscribe: () => () => {},
    fetchAfter: async () => ({ events: [], next: 0 }),
    send: async () => ({ messageId: "m", seq: 1, delivery: "queued" }),
    retry: async () => ({ messageId: "m", seq: 1, delivery: "sent" }),
  }) as unknown as ChatTransport;

function counted() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    if (renders > 50) throw new Error(`useAgentThread re-rendered ${renders} times`);
    return useAgentThread({ transport: inline() });
  });
  return { ...hook, renders: () => renders };
}

describe("capabilities belong to their transport", () => {
  it("a new transport reads null until its own capabilities load", async () => {
    const a = { ...inline(), capabilities: async () => ({ cancel: false, steering: false, approvals: true }) } as ChatTransport;
    const b = inline();
    const { result, rerender } = renderHook(({ t }) => useAgentThread({ transport: t }), { initialProps: { t: a } });
    await act(flush);
    expect(result.current.capabilities).toEqual({ cancel: false, steering: false, approvals: true });
    rerender({ t: b });
    await act(flush);
    expect(result.current.capabilities).toBeNull();
  });
});

describe("a host that builds its transport inline", () => {
  it("settles after a send", async () => {
    const { result, renders } = counted();
    await act(async () => {
      await result.current.send({ parts: [] });
    });
    await act(flush);
    expect(renders()).toBeLessThan(10);
  });

  it("settles after a retry", async () => {
    const { result, renders } = counted();
    await act(async () => {
      await result.current.retry("u_1");
    });
    await act(flush);
    expect(renders()).toBeLessThan(10);
  });
});
