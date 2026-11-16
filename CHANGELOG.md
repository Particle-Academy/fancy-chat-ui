# Changelog

All notable changes to this project are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**This package is pre-1.0, so breaking changes land in MINOR releases.** The
version number is not a stability promise until 1.0; read the entry.

## [Unreleased]

### Changed

- The react-fancy devDependency (the version the suite and the lab build against)
  moves from the `cc0042-triggers` commit `fec48c0` to `85b2ec4`, the same triggers
  work rebased onto react-fancy 6.26.1 and versioned 6.27.0. The peer range is
  unchanged (`>=6.27.0 <7`), so nothing to do.

### Added (impactium follow-ups)

- **The full fact listing on open.** An optional adapter method
  `listFacts(subject | null, cursor | null, limit)` returning prism-graph's g282.2
  listing (`{contractVersion: "g282.2", items, nextCursor}`, accepted facts by
  default): with it, `FactsExplorer` loads every fact when it opens, fills the map at
  once, pages with Load more, and the subject field filters. Any other version, g282.1
  included, is refused. Without it nothing changes: facts load once a subject is given.
  `readFactListingV2`, `G282_2_VERSION`.
- **Retry a failed turn with its original input.** `transport.retry(turnId)` posts
  `threads/{id}/turns/{turnId}/retry`; `useAgentThread().retry(turnId)` calls it (and
  rejects when the transport has no `retry`). `AgentThread` takes `chat` (the hook's
  result) and its Retry defaults to `chat.retry`; an explicit `onRetryTurn` wins.
  Requires fancy-chat-js with `TurnEntry.messageId` (068bbe3).

### Fixed (impactium follow-ups)

- **A git install no longer nests builds.** `dist/` is committed and `prepare` is gone,
  so installing fancy-chat-ui from git runs no build and installs none of its
  devDependencies. Before, `prepare` made npm install this package's devDependencies,
  which are themselves git pins (fancy-chat-js, react-fancy), each building in turn:
  impactium measured 20+ minutes. CI checks the committed `dist/` is current.
- **A settled timeline hid its failures.** `ActivityTimeline` collapsed on settle and
  unmounted every row, so a failed tool's text sat behind "Show steps". Collapsed, it
  now keeps each failed tool's row visible, failure text included.

### Added (CC-fancy-0042, after the Overseer and impactium dogfood)

- **Tool output inline.** `ToolRow` shows a tool result's `output` (fancy-chat-js
  `ToolEntry.output`): a failure's own words without expanding, an ok result's when
  expanded, as escaped text or, with `outputLanguage`, as code. Never HTML. It shows
  at most `maxOutputChars` (default 4000) and says when it is shortened (or when the
  server cut it). `resolveOutput(ref, entry)` lazily loads the rest behind `outputRef`,
  once, only when the row is expanded; a failure shows in the row. `AgentThread` takes
  `resolveToolOutput`, `renderToolOutput` (the host's own view, ToolRow `renderOutput`)
  and `maxToolOutputChars`, and passes them to every tool row.
- **`ActivityTimeline`** (on react-fancy Timeline): a run's thinking and tool calls,
  expanded while running, collapsed to "3 tool calls · 4.2 s · 1 failed" once settled.
  `AgentThread activity="timeline"` groups each run's consecutive activity into one.
- **`ModelError`**: a failed turn's reason and Retry (a refusal is neutral, no Retry).
  `AgentThread` shows it for the newest turn; `onRetryTurn` wires Retry.
- **Facts explorer** in `./knowledge` (prism-graph 0.3 shapes): `FactsExplorer` lists a
  subject's facts with status (Accepted, Proposal, Belief); a drawer shows the evidence
  passages with provenance and the predicate's version timeline; `FactGraph` in
  `./charts` draws subjects, facts and evidence on fancy-echarts' graph series
  (`factGraphOption` builds the option without ECharts). Accept and Reject are
  HUMAN-only callbacks (`onAccept`, `onReject`), never adapter methods, shown on
  proposals only, locked while in flight. New adapter methods `facts`, `factTimeline`,
  `getChunks` return g282.1 listings; any other version is refused and named.
  `KnowledgeExplorer` embeds it when the adapter has `facts`.
- **`mode: "interval"`** on `createHttpTransport`, for a host with one PHP worker:
  short polls only while a turn runs (and briefly after an action), with back-off and a
  pause while the tab is hidden. All timings configurable (`interval`).
- **Backend capabilities.** `transport.capabilities()` (GET
  `threads/{id}/capabilities`), `useAgentThread().capabilities`, and AgentComposer
  `canStop`: pass `canStop={chat.capabilities?.cancel !== false}` and a backend that
  cannot cancel shows the turn running with no Stop.
- **Several thinking blocks per run** render as their own rows, in order, each with its
  `thinkingId` as `data-fancy-chat-thinking`; a bounded duration renders "≤ 1.2 s".
- README: Install (git over HTTPS, `ignore-scripts`, the lockfile's `git+ssh`), the
  server routes and their answers, transport modes.

### Fixed

- **SECURITY: an image `src` of `//host/x` was accepted as same-origin.** It is
  protocol-relative, so it loads from another origin. Only `http(s)://` and a root
  path (`/x`, not `//x` or `/` followed by a backslash) are accepted now. Nothing to do
  unless your `resolveRef` returned protocol-relative URLs on purpose; return absolute
  `https://` URLs instead.
- `useAgentThread().decide` dropped `edited`; it now passes it to the server.
- `ToolRow` no longer throws on an entry without `output` (from a fancy-chat-js that
  predates it).
- `ActivityTimeline` and the fact versions render react-fancy's Timeline with
  `animated={false}`: an animated item stays hidden until scrolled into view, and
  needs IntersectionObserver.
- The README's Develop section described `file:` sibling links that no longer exist.

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

- **Installable from git, and reproducible to install.** `prepare` builds `dist/`, so
  `npm install github:Particle-Academy/fancy-chat-ui#<sha>` works before a release, and
  the unreleased dev dependencies (fancy-chat-js, react-fancy) are pinned git commits
  rather than `file:` paths, so `npm ci` installs the same tree anywhere, CI included.
- **The react-fancy peer is now `>=6.27.0 <7`**, for PromptInput `triggers`. A git install
  of react-fancy's `cc0042-triggers` branch reports 6.27.0, the code that release ships.
  Unpublished, so nothing to do.
- A superseded message and its branch are hidden by default (branch policy). Pass
  `showBranches` to show them.

### Security

- `createHttpTransport` trims trailing slashes from `baseUrl` with a linear scan.
  The regex it used before this first release was quadratic on a long run of
  slashes that were not at the end (code scanning #1, polynomial ReDoS):
  100,000 slashes took 5.6 s. Never published, so nothing to upgrade.
