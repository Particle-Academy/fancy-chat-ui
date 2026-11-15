# AGENTS.md — fancy-chat-ui

`CLAUDE.md` is a symlink to this file.

**This file describes THIS REPO'S CODE and nothing else.** Process rules live in
the envelope's `RULES.md` and must never be copied here.

## What this package is

React agent-chat surfaces (CC-fancy-0042), composed from react-fancy, rendering the
neutral contract in fancy-chat-js. No Prism import.

## Layout

| file | what lives there |
|---|---|
| `src/transport.ts` | HTTP transport: SSE, long-poll fallback, the POST routes. Sends no actor, ever. `wait` is milliseconds (what fancy-chat-php reads). |
| `src/store.ts` | Seq log + the fancy-chat-js reducer; gap repair; the optional nudge; drops a cancelled turn's tail by turnId. |
| `src/useAgentThread.ts` | The hook over the store, with `actionableId` and the actions. |
| `src/AgentThread.tsx` | VirtualList + ChatMessage `body`; row renderers; HITL placement. |
| `src/AgentComposer.tsx` | PromptInput with per-thread drafts (`draftKey`), Stop, outcome line. |
| `src/PartView.tsx`, `src/activity.tsx`, `src/ApprovalCard.tsx`, `src/QuestionForm.tsx` | Parts, activity rows, HITL. |
| `src/actionable.ts` | The one place a projected state becomes "which item is actionable". |

## Invariants (each has a test, and a sabotage entry that proves it)

1. **Reuse, never reimplement** (owner, 2026-11-15). If a react-fancy primitive lacks
   something, add it there (PromptInput `running`/`onStop`/`draftKey`, ContentRenderer
   `holdBack`/`transform`, VirtualList `anchorOnPrepend`, ChatMessage `body` all came
   from this package's needs). The contract lives in fancy-chat-js; never copy a
   machine, a validator or the projection here.
2. **No decision carries an actor or a decision.** `decide` sends `{ optionId, note? }`;
   the server resolves both the actor and the decision.
3. **Tone and decision come from the option kind.** An option of an unknown kind is not
   offered.
4. **One actionable HITL item; an in-flight decision locks.** The lock is a ref, so it
   holds within one tick, before React re-renders.
5. **Links only to http(s)**, in card actions and resolved files, with `rel="noopener"`.
6. **Never drop a part.** An unknown kind renders `partToText` in a chip.
7. **The projected `state` is mutated in place by the store.** Memoise on
   `snapshot.version`, never on `state` identity.

## Dev dependencies

`file:../fancy-chat-js` and `file:../react-fancy` with `install-links=true` (a symlink
would load a second React). CI's Install step is red until both are on npm; then they
become carets.
