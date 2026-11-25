# Changelog

All notable changes to this project are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**This package is pre-1.0, so breaking changes land in MINOR releases.** The
version number is not a stability promise until 1.0; read the entry.

## [Unreleased]

## [0.5.2] - 2026-11-25

### Fixed

- **The composer's send outcome stayed on "Queued" after the queued message was
  delivered, run and answered (Tynn #259).** `AgentComposer` `outcome` was only ever
  a value the host set from the send response, once, and nothing in this package
  offered a way to keep it current, so a message that queued behind a running or
  parked turn (or a quick reply sent with `sendSuggestion`) kept saying "Queued"
  after the turn had settled and the answer was on screen. fancy-chat-js already
  projected the message's `delivery` moving from `queued` to `delivered`; the line
  never read it.
  - New `useAgentThread().outcome`: the newest `send`, `sendSuggestion` or `retry`'s
    outcome, re-derived from the message's delivery in the projection on every
    event. It is null once the message is delivered and for a plain `sent`; it shows
    `queued`, `steered`, `decided`, `unsent` or `dropped` while that is the message's
    state; a rejected send shows `failed` with the error until the next send. Only
    the newest send writes it, and a new transport starts with none.
  - New `sendOutcomeOf(state, outcome)` and optional `SendOutcome.messageId`, for a
    host that keeps the outcome in its own state: store the response's `messageId`
    and pass `sendOutcomeOf(chat.state, outcome)`.
  - Upgrading: pass `outcome={chat.outcome}` to `AgentComposer` and drop your own
    outcome state. A host that keeps its own outcome and changes nothing sees the
    same line as before, stale "Queued" included, because the composer shows the
    value it is given. Nothing else changes: `send`, `sendSuggestion` and `retry`
    resolve and reject exactly as before.
- **`useAgentThread` no longer re-renders forever after an update when the host
  builds its transport inline** (a new transport object every render). The
  capabilities effect reset its state on every transport change, so any other
  update (the send outcome above, for one) started an endless render loop. The
  capabilities are now keyed by their transport instead, and a new transport still
  reads `null` until its own capabilities load. The README's `useMemo` transport was
  never affected. Upgrading: nothing to do.
- The test config set `esbuild.jsx`, which Vite 8 ignores with a warning on every
  run; it now sets `oxc.jsx` instead. Tests only, nothing ships.

## [0.5.1] - 2026-11-25

### Fixed

- **Quick replies never reached a page on the interval (polling) transport.**
  fancy-chat-php generates them in a separate job AFTER the turn settles, but
  `mode: "interval"` stopped polling the moment the newest turn settled (with
  `idleMs` null by default, and `graceMs` only after a local action), so
  `suggestions.updated` landed after polling had ended and the chips never showed.
  Interval mode now keeps polling after the newest turn settles `completed`, with
  its usual back-off, until that turn's `suggestions.updated` arrives (an empty list
  counts) or a bounded window passes, with the last poll on the bound. It never
  polls forever, opens no window after a failed, refused or cancelled turn, and a
  thread loaded long after its last turn opens none either.
  - New option `interval.suggestionsMs`, default `15000` (fancy-chat-php's
    `suggestions.timeout_seconds`). Raise it if your server's timeout or queue is
    slower; `0` restores the old stop-at-settle behaviour.
  - New optional `SubscribeHandlers.suggestionsDue`, which the thread store supplies.
    A custom transport can ignore it.
  - Upgrading: nothing to do. A host that never enables quick replies pays a few
    backed-off polls after each completed turn; set `suggestionsMs: 0` to avoid them.

## [0.5.0] - 2026-11-25

### Added

- **Quick replies (CC-fancy-0065): chips under the agent's last reply.** `AgentThread`
  takes `suggestions` (controlled, `{ id, text }[]`), `onSuggest` and
  `suggestionsHidden`. The chips render only with `onSuggest`, and stay hidden while
  any turn is unsettled, while an approval is pending or a question open, once the
  newest message is the human's, and whenever the host sets `suggestionsHidden` (for
  its own decision states, such as an approval-queue modal). They are real buttons
  in a `role="group"` labelled by the new `labels.quickReplies` ("Suggested
  replies"), with the arrow keys moving between them; handles
  `data-fancy-chat-suggestions` and `data-fancy-chat-suggestion="<id>"`. Text is
  rendered as plain text, never markdown or HTML.
  - A pick calls `onSuggest({ id, text })` and nothing else. `useAgentThread` now
    returns `suggestions` (read from fancy-chat-js `state.suggestions`, only for the
    newest turn) and `sendSuggestion`, which sends it as an ordinary message (one
    plain-text part); `suggestionDraft` fills the composer instead. Neither can
    decide, answer or call a tool.
  - New exports: `QuickReplies`, `quickRepliesHidden`, `suggestionsOf`,
    `suggestionDraft`, `suggestionMessage`, and the types `QuickReply`,
    `QuickRepliesProps`.
  - **What to do:** nothing; without `onSuggest` nothing renders. If you pass your own
    complete `ChatLabels` object (not a partial), add `quickReplies`. Chips need a
    fancy-chat-js and a server that send `suggestions.updated`; with an older one
    `chat.suggestions` is simply `[]`.

### Changed

- **Peer `@particle-academy/fancy-chat-js` is now `>=0.3.1 <2.0`** (was `>=0.1.0 <2.0`),
  and the devDependency `^0.3.1` (was `^0.2.0`). 0.3.1 is the first fancy-chat-js with
  `suggestions.updated` that is free of the 0.3.0 ReDoS in `isSuggestionText`.
  - **What to do:** if npm reports a peer conflict, update fancy-chat-js to 0.3.1 or
    later (`npm i @particle-academy/fancy-chat-js@latest`). Nothing else changes.

## [0.4.0] - 2026-11-23

### Added

- **`AgentThread` takes `renderApproval`**, to replace just the approval card, in
  approval rows and in approvals embedded in message parts. Until now `renderRow`
  could only replace a whole row. Additive; a host that does not pass it renders
  exactly as before, so consumers do nothing.
  - `renderApproval(record, { actionable, onDecide, labels })`: `undefined` keeps the
    default `ApprovalCard`, `null` renders nothing for that approval, anything else
    replaces the card. New exported types: `ApprovalRenderer`, `ApprovalRenderContext`.
  - Presentation only. `actionable` is the same value the default card gets, and
    decisions go through `onDecide`. The default card's in-flight lock is inside the
    card, so a custom renderer that can be clicked twice must guard that itself.
  - A replaced or hidden approval keeps `data-fancy-chat-approval` and its `-state`
    and `-actionable` handles on a wrapper. With `null` the handle stays in the DOM
    but out of the layout: a row, or a message holding nothing else, moves out of the
    virtual list so it leaves no blank gap.

## [0.3.0] - 2026-11-18

**What a consumer must do.** Nothing: every change is additive. The one visible
difference with no props set is that a `FactGraph` fact node's tooltip now shows
its valid range under its name.

### Added

- **Tests and docs for `AgentComposer` `attachments` (CC-fancy-0043).** The prop
  shipped in 0.2.0 and depends on react-fancy 6.28.0's PromptInput `attachments` (the
  peer is already `>=6.28.0 <7.0`). New tests show that with `attachments={false}` a
  dropped or pasted file never reaches the draft, and that with it on (explicit or
  default) a dropped file does. Both `false` tests fail if the composer stops passing
  the prop on. `AGENTS.md` gains a prop row for it. Additive; default unchanged,
  consumers do nothing.
- **CC-fancy-0044 on the map: `FactGraph` takes `evidenceLabel` and `formatDate`.**
  Additive; consumers do nothing.
  - `formatDate?: (iso) => string`: each fact node carries `validFrom` (and `validTo`
    when it has one) through it, and `FactGraph`'s tooltip shows the range as plain
    text (escaped). Default `defaultFormatDate`, the same as `FactsExplorer`'s: the
    user's locale via `Intl.DateTimeFormat`; an unparseable value shows as it came.
  - `evidenceLabel?: (evidence) => string`: an evidence node's name, for a loaded
    chunk. Default `defaultGraphEvidenceLabel` (new export): the chunk's `sourceTitle`
    when it has one, else today's name, the passage's first 60 characters. A chunk
    that is not loaded still shows its id.
  - `factGraphOption(facts, categories, chunks, options?)` takes the same two in a new
    optional fourth argument (`FactGraphOptions`, exported).
  - `FactsExplorer` hands its `formatDate`, and its `evidenceLabel` when one is passed,
    to its `graph` component. Its own date and evidence-line output is unchanged.
  - The one visible change with no props set: a fact node's tooltip now shows its
    valid range under its name.

### Changed

- **CI: the lab-certificate gate verifies against the lab's rotated key list.**
  The lab's first signing key is retired: certificates it already issued still
  verify, and nothing new it signs ever can. Consumers do nothing.

- **Docs:** the install sections in `AGENTS.md` and the README now use the registries (`npm i @particle-academy/fancy-chat-js @particle-academy/fancy-chat-ui`, `composer require particle-academy/fancy-chat-php`) instead of git installs, the git-install traps are gone, and the README's MCP note says the package is listed on the Fancy MCP catalog server. No code changed; nothing to do. npm shows the README and `AGENTS.md` as of the last publish, so the 0.2.0 page keeps the old text until the next release.
- **Dev:** the `@particle-academy/fancy-chat-js` devDependency is `^0.2.0` from npm instead of a git commit. The peer range (`>=0.1.0 <2.0`) is unchanged; nothing to do.
- CI: re-pin org third-party allowlist to 2614224
- **Dev:** the sabotage sweep's "a lenient date is guessed" mutation targets
  `src/knowledge/format.ts`, where `defaultFormatDate` moved with CC-fancy-0044.
  It still named `FactsExplorer.tsx`, so the sweep reported it missing and CI was
  red. The mutation is caught again. No code changed; nothing to do.

## [0.2.0] - 2026-11-16

Never published; 0.2.0 because the knowledge types and the react-fancy peer change.

### Added

- **`AgentComposer` `attachments?: boolean`**, passed through to react-fancy
  PromptInput (6.28.0). On by default: what is attached reaches `onSend` with its
  File, for the host to upload and send as `image` / `file` parts. `false` removes
  every way to attach. The README shows the upload-then-send binding.
- **CC-fancy-0044, in the facts views:**
  - `formatDate?: (iso) => string` on `FactsExplorer`, used for every fact date,
    `validRange` included. Default `defaultFormatDate`: `Intl.DateTimeFormat` with
    `dateStyle: "medium"` and `timeStyle: "short"`; an unparseable value shows as it came.
  - `evidenceLabel?: (evidence) => string`. Default `defaultEvidenceLabel`: today's
    line, led by the chunk's `sourceTitle` as-is (it can be a URI). Each label has a
    `data-fancy-chat-fact-evidence-label` handle.
  - An optional `sourceTitle` on `KnowledgeChunk`, validated as a string when present.
    fancy-chat-php 0.2.0's `KnowledgeBridge` fills it from prism-graph's `getSource`.

### Changed

- **Docs:** `AGENTS.md` is now the guide to using this package (install, how to find it on the Fancy MCP catalog server once it is listed, API essentials, traps), and it ships in the package. The contributor notes it held moved to `CONTRIBUTING.md`, and `CLAUDE.md` is now a symlink to it. The README points to the MCP server and to `AGENTS.md`. No code changed; nothing to do. (This entry sat under Unreleased when 0.2.0 was tagged; 0.2.0 ships it.)
- **Built on Prism, not provider-neutral** (owner, 2026-11-16): the CC-fancy-0042
  ruling meant the extras (graph, memory, the browser) are optional, not Prism
  itself. The docs say so; the code that renders the thread log is unchanged.
- **BREAKING (types only): the knowledge shapes are prism-graph's.** `KnowledgeSource`
  is `ListedSource`, `KnowledgeListing<T>` is `ListingPage<T>`, `KnowledgeChunk` is
  `ListedChunk` plus `sourceTitle?` and `retired?`, `KnowledgeFact` is `Fact` with a
  status, `FactStatus` is prism-graph's, from `@particle-academy/prism-graph` (a new
  OPTIONAL peer, `>=0.3.0 <2.0`, imported for types only). They are readonly, and
  provenance line and byte numbers are non-null. What to do: if you type-check code
  against `./knowledge`, add `@particle-academy/prism-graph` as a dev dependency.
  Nothing changes at runtime, and the validators still accept what they accepted.
- **BREAKING: peer `@particle-academy/react-fancy >=6.28.0 <7.0`** (was `>=6.27.0`),
  for PromptInput `attachments`. Update react-fancy.

### Removed

- **The no-Prism packaging check** (`npm run check:no-prism`, its CI step and test).
  The root entry's isolation test stays: `.` never reaches `./knowledge`, `./charts`
  or fancy-echarts, and no built file imports prism-graph at runtime.

## [0.1.0] - 2026-11-16

### Fixed

- **An event the reducer cannot apply no longer stalls the thread.** If
  `applyEvent` threw (fancy-chat-js 0.1.0 does on a `plan.updated` with a null
  step), the throw reached the transport as a failed request, which retried the
  same batch forever: every poll received the events and nothing rendered. The
  store now skips such an event, counts it in `snapshot.dropped`, moves the cursor
  past it and applies the rest of the batch. The first event a store refuses,
  whether it threw or is illegal under the contract, logs one `console.warn`. Nothing to do.
- **`snapshot.error` clears once a later request succeeds:** a poll that
  answers, a stream that opens or delivers, or a gap repair that lands. It used
  to stay set forever after one failure. New optional `SubscribeHandlers.onHealthy`,
  which `createHttpTransport` calls; a custom transport that never calls it keeps
  the old behaviour. Nothing to do.
- **Newer page props for the same thread are taken.** `useAgentThread` built its
  store from `initial` once and ignored every later `initial`. A thread that was
  not polling (idle, or parked on a human who then acted in another tab) kept
  showing the old state after an Inertia partial or memory reload, and only a full
  reload caught it up. Props AHEAD of the store by `lastSeq` now apply as a snapshot
  jump. Props at or behind it are still ignored, so nothing applied is rolled back.
  No polling was added. Nothing to do.
- **An approval or question that arrives in an open thread becomes actionable
  without a remount.** `AgentThread` memoised `actionableId` on the projected
  `state` object, which the store mutates in place, so the memo was computed once
  when the thread opened. With a stable `actionableKinds` (a surface profile's
  `hitl.actionable`, or a constant) nothing else in its key changed, and a later
  approval rendered as waiting, with its options disabled, until the thread was
  remounted. It is no longer memoised. The superseded-branch maps are now keyed on
  `rows` (new on every applied event) as well as `state`. Rows themselves were
  never affected. Interval polling and SSE both had it. Nothing to do.
- **Locks and loads under React StrictMode (dev).** `ApprovalCard`,
  `QuestionForm`, `KnowledgeExplorer` and `FactsExplorer` set their
  "mounted" ref only at creation and cleared it in the effect cleanup, so
  StrictMode's cleanup-and-rerun left it false: a failed decision or answer kept
  the card locked for good, and both explorers discarded everything they loaded.
  The ref is now set on every mount. Production builds were not affected. Nothing to do.
- **A failing poll or event stream is no longer silent.** A poll answered 401 or
  419 (a session that ended, or one a login regenerated), or one that never
  answered (a network failure), set `snapshot.error`, which nothing renders, and
  retried quietly. An SSE failure reported nothing at all. Now every failure
  reaches `onError` (so `snapshot.error`), SSE included, and each failure streak
  logs one `console.warn` naming the route and the HTTP status. Retry timing is
  unchanged. Nothing to do. A console warning is new output in your dev tools.

### Added

- Regression tests for interval polling in an open thread across a hidden tab,
  a poll in flight when the tab hides, focus loss, a stale `initial` restored on
  an Inertia visit, and a partial reload. They passed before the fixes above as
  well: they guard behaviour that already worked and are not tests of a fix.

### Changed

- The fancy-chat-js devDependency (what the suite and the lab build against) is
  pinned to the fancy-chat-js commit whose `applyEvent` never throws. The peer
  range is unchanged, `>=0.1.0 <2.0`. Nothing to do.
- **Builds against the released react-fancy 6.27.0.** The peer range is
  `>=6.27.0 <7.0`, and the devDependency the suite and the lab build against is
  `^6.27.0` from npm, no longer a git commit. react-fancy 6.27.0 is the release
  of the PromptInput `triggers` work this package needs, so nothing to do.

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
