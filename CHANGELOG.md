# Changelog

All notable changes to this project are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**This package is pre-1.0, so breaking changes land in MINOR releases.** The
version number is not a stability promise until 1.0; read the entry.

## [Unreleased]

### Added

- **First release: React agent-chat surfaces on react-fancy** (council change
  CC-fancy-0042). Nothing to migrate; this is new.
  - `createHttpTransport`: SSE resuming after the last seq, with a long-poll fallback
    when SSE fails before delivering anything. Decisions carry no actor.
  - `createThreadStore` / `useAgentThread`: seq dedupe, gap repair, the fancy-chat-js
    reducer and projection, an optional Echo/Reverb nudge, and `actionableId`.
  - `AgentThread` on VirtualList and ChatMessage: virtualised log, controlled follow,
    Jump to latest, deep link, Load earlier with prepend anchoring.
  - `AgentComposer` on PromptInput: per-thread drafts, Stop while running, and a
    send-outcome line.
  - `PartView`, `ThinkingBlock`, `ToolRow`, `PlanRow`, `ApprovalCard`, `QuestionForm`.
  - Requires react-fancy 6.26.0 (PromptInput `running`/`onStop`/`draftKey`,
    ContentRenderer `holdBack`/`transform`, VirtualList `anchorOnPrepend`, ChatMessage
    `body`) and fancy-chat-js 0.1.0, both peers.
- **`./charts` entry (optional):** `chartPartRenderer({ allowRawOptions?, height?, theme?, renderer? })`
  renders the `chart` part on `@particle-academy/fancy-echarts`, a new OPTIONAL peer
  (`>=6.3.0 <7`) that only this entry imports.
  - `chartSpecToOption` maps the neutral spec (`line`, `bar`, `area`, `pie`, `scatter`)
    and emits only the keys it names.
  - Raw `part.echarts` options are refused by default (the part's plain text shows
    instead) and render only with `allowRawOptions: true`.
  - A spec the contract rejects falls back to text.
  - Nothing to do unless you render charts; then install fancy-echarts and register the
    renderer.
- **`./knowledge` entry (optional):** `KnowledgeExplorer` over a host-scoped
  `KnowledgeAdapter`:
  - search;
  - sources with cursor paging;
  - a source's chunks, with provenance, in a Drawer;
  - ingest status with a worker banner.

  It reads the g282.1 shapes agreed with Prism. Every listing, ingest job and worker
  status must carry `contractVersion: "g282.1"`; anything else is refused, and the
  version that arrived is named. `deriveIngestDisplay` holds the ingest rule:
  - until ingest jobs land (`jobsAvailable`, default false), only done or failed shows;
  - after that, queued and running show only on a fresh worker heartbeat, and a stale
    one raises "nothing is processing";
  - unknown is never rendered as running.

  There is no scope prop.
- `npm test` now builds first (`pretest`) so the packaging test can read the
  metafile.

- Phase 2 surfaces (CC-fancy-0042):
  - `QueueBar` and `queuedMessages`: unsend one, send all, discard, Send now after a
    configurable wait (default 2 minutes), interrupt and send.
  - `createTriggerRegistry` / `serializePill`: per-character app pickers (MOIC's
    `@ # / $ &` and a backtick) on PromptInput `triggers`, serialised to
    `[kind:target|label]`; a label can never close or split its pill.
  - Surface profiles: `defineSurfaceProfile` (validated at definition), the
    `profile` prop on AgentThread (part kinds and actionable HITL kinds), `profileId`
    on the transport (`X-Fancy-Chat-Profile`, `profile=` on the streams), and one
    shared store across surfaces (`useAgentThread({ store })`; reference-counted, so
    the last surface to unmount disconnects).
  - `UndoCountdown` and undo rows in AgentThread; `revertUndo` on the transport and
    the hook.
  - Edit and resend: superseded branches hidden by default with a toggle
    (`showBranches`, controlled), and Edit on the viewer's own live messages
    (`onEdit`).
  - Held plan steps link to their approval (`onShowApproval`).
  - Typed approval, opt-in: AgentComposer's `typedApproval` warns when the draft will
    be taken as a decision; `SendResult.typedDecision` reports when the server did.
  - A message the server took as a typed decision shows delivery `decided`
    ("Taken as your decision"), never as delivered.
  - `npm run test:e2e`: the transport and store against fancy-chat-php's harness. It
    fails, never skips, when PHP or the harness is missing.

### Changed

- **The react-fancy peer is now `>=6.27.0 <7`**, for PromptInput `triggers`.
  Unpublished, so nothing to do.
- A superseded message and its branch are hidden by default (branch policy). Pass
  `showBranches` to show them.

### Security

- `createHttpTransport` trims trailing slashes from `baseUrl` with a linear scan.
  The regex it used before this first release was quadratic on a long run of
  slashes that were not at the end (code scanning #1, polynomial ReDoS):
  100,000 slashes took 5.6 s. Never published, so nothing to upgrade.
