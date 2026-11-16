# AGENTS.md — fancy-chat-ui

`CLAUDE.md` is a symlink to this file.

**This file describes THIS REPO'S CODE and nothing else.** Process rules live in
the envelope's `RULES.md` and must never be copied here.

## What this package is

React agent-chat surfaces (CC-fancy-0042), composed from react-fancy, rendering the
fancy-chat-js thread log a server projects Prism Harness runs into. `./knowledge`
reads prism-graph's TYPES (`import type` only: a runtime import would pull its
`node:sqlite` driver into a browser bundle; `tests/packaging.test.ts` fails on one).

## Layout

| file | what lives there |
|---|---|
| `src/transport.ts` | HTTP transport: SSE, long-poll fallback, the POST routes. Sends no actor, ever. `wait` is milliseconds (what fancy-chat-php reads). |
| `src/store.ts` | Seq log + the fancy-chat-js reducer; gap repair; the optional nudge; drops a cancelled turn's tail by turnId. |
| `src/useAgentThread.ts` | The hook over the store, with `actionableId` and the actions. |
| `src/AgentThread.tsx` | VirtualList + ChatMessage `body`; row renderers; HITL placement. |
| `src/AgentComposer.tsx` | PromptInput with per-thread drafts (`draftKey`), Stop, outcome line. |
| `src/PartView.tsx`, `src/activity.tsx`, `src/ApprovalCard.tsx`, `src/QuestionForm.tsx` | Parts, activity rows, HITL. |
| `src/QueueBar.tsx`, `src/UndoCountdown.tsx` | The queue behind a running turn; the undo window (a display: the server decides lateness). |
| `src/triggers.ts` | The trigger registry over PromptInput `triggers`, and the pill serialiser. |
| `src/profile.ts` | Surface profiles: validated at definition; parts and HITL kinds per surface. |
| `tests/e2e/` | `npm run test:e2e` against fancy-chat-php's `tests/e2e/serve.php`. Fails, never skips, without it. |
| `src/actionable.ts` | The one place a projected state becomes "which item is actionable". |
| `src/knowledge/` | OPTIONAL `./knowledge` entry: g282.1 validators (`shapes.ts`), `deriveIngestDisplay` (`ingest.ts`), `KnowledgeExplorer`. |
| `src/charts/` | OPTIONAL `./charts` entry: `chartSpecToOption` (`spec.ts`) and `chartPartRenderer` on fancy-echarts. The only file that imports fancy-echarts. |

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
8. **The root entry never reaches `./knowledge`, `./charts` or fancy-echarts.**
   `tests/packaging.test.ts` walks the built metafile from `dist/index.js`. `npm test`
   builds first (`pretest`), and the sabotage sweep runs `npm test` for this reason.
9. **Knowledge data carries `contractVersion: "g282.1"` or it is refused, never
   guessed.** The ingest rule lives in `deriveIngestDisplay` alone:
   - without `jobsAvailable`, only done or failed is shown;
   - with it, queued and running show only on a fresh worker heartbeat;
   - `unknown` is never rendered as running.

   No scope prop exists; the adapter binds the scope.
10. **Raw ECharts options render only with `allowRawOptions: true`.** Validity comes
    from fancy-chat-js `validatePart`, the same validator the servers run, and only
    keys `chartSpecToOption` names reach ECharts.

11. **One engine, many surfaces.** `store.start()`/`stop()` are reference-counted;
    a surface unmounting never disconnects the others.
12. **A pill label can never close or split its pill.** `serializePill` strips the
    grammar's delimiters and control characters.

## Dev dependencies

`@particle-academy/react-fancy` comes from npm (`^6.28.0`). Until it is on npm,
`@particle-academy/fancy-chat-js` is a pinned git commit over HTTPS
(`git+https://github.com/Particle-Academy/<repo>.git#<40-char sha>`; never SSH, which a
CI runner cannot clone); its `dist/` is committed, so it builds nothing and `npm ci`
reproduces exactly. A git pin of a package that builds in `prepare` (react-fancy did)
fails `npm install` on CI with "Cannot read properties of null (reading 'edgesOut')". A test refuses a `file:` path. Re-pin
by editing the sha and running `npm install`. To try an unpushed sibling locally, use
`npm install --no-save --install-links ../<repo>`, which leaves the manifest alone.
This package also builds in `prepare`, so it installs from git itself.
