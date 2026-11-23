import { isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { Badge, Button, Card, CodeBlock, ContentRenderer, Table, Text } from "@particle-academy/react-fancy";
import type { ContentRendererProps } from "@particle-academy/react-fancy";
import { partToText, type Part, type PartRegistry } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";

/** Renders one part kind. Hosts register these for `x-*` kinds and for `chart`. */
export type PartRenderer = (part: Part, ctx: PartRenderContext) => ReactNode;

export interface PartRenderContext {
  streaming: boolean;
  labels: ChatLabels;
  renderPart: (part: Part) => ReactNode;
}

/** A host resolver for `file` / `image` refs. Returning null renders the name with no link. */
export type RefResolver = (part: Part) => { href?: string; src?: string } | null;

export interface PartViewProps {
  part: Part;
  /** True while this part is still streaming (its id is in the message's `open`). */
  streaming?: boolean;
  renderers?: Record<string, PartRenderer>;
  registry?: PartRegistry;
  resolveRef?: RefResolver;
  /** A card action with kind `post-back`: a recorded human action. It can never decide an approval. */
  onCardAction?: (part: Part, actionId: string) => void;
  /** Options for every text part's ContentRenderer (extensions, a markup holdBack, ...). */
  contentOptions?: Pick<ContentRendererProps, "extensions" | "copyButtons" | "onCopy" | "clipboardWriter" | "holdBack" | "transform" | "lineSpacing">;
  /** How `approval` and `question` parts render: the thread places the HITL record here. */
  renderHitl?: (part: Part) => ReactNode;
  labels?: Partial<ChatLabels>;
  /** A surface profile's part kinds. Any other kind renders as its plain text. */
  allowedKinds?: readonly string[];
}

const SAFE_HREF = /^https?:\/\//i;
/**
 * A root path on THIS origin: one slash, then anything but a second slash or a
 * backslash. `//host/x` is protocol-relative (another origin), and browsers read
 * a backslash after the first slash as a slash, so `/\host/x` is too.
 */
const SAME_ORIGIN_PATH = /^\/(?![\/\\])/;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

/**
 * Internal (not exported from the package): a HITL item the host chose to render
 * as nothing. It keeps the item's data-* handle, and PartView hides its wrapper.
 */
export function HiddenHitl(props: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div {...props} hidden />;
}

/**
 * One message part, composed from react-fancy. Text goes through
 * ContentRenderer (sanitised; held back while streaming), code through
 * CodeBlock, tables through Table. A kind nobody registered renders its plain
 * text in a chip, never silently dropped.
 */
export function PartView(props: PartViewProps): ReactNode {
  const { part, streaming = false, renderers, registry, resolveRef, onCardAction, contentOptions, renderHitl } = props;
  const labels = mergeLabels(props.labels);
  const renderPart = (child: Part) => <PartView {...props} part={child} streaming={false} />;
  const ctx: PartRenderContext = { streaming, labels, renderPart };
  const handle = { "data-fancy-chat-part": part.id, "data-fancy-chat-part-kind": part.kind };

  const allowed = !props.allowedKinds || props.allowedKinds.includes(part.kind);
  const custom = allowed ? renderers?.[part.kind] : undefined;
  if (custom) return <div {...handle}>{custom(part, ctx)}</div>;

  switch (allowed ? part.kind : "") {
    case "text":
      return (
        <div {...handle}>
          {part.format === "plain" ? (
            <Text className="whitespace-pre-wrap break-words">{asString(part.text)}</Text>
          ) : (
            <ContentRenderer {...contentOptions} value={asString(part.text)} format="markdown" streaming={streaming} />
          )}
        </div>
      );
    case "code":
      return (
        <div {...handle}>
          <CodeBlock code={asString(part.code)} title={typeof part.filename === "string" ? part.filename : undefined} language={asString(part.language) as never} />
        </div>
      );
    case "table": {
      const columns = (Array.isArray(part.columns) ? part.columns : []) as { key: string; label: string }[];
      const rows = (Array.isArray(part.rows) ? part.rows : []) as Record<string, unknown>[];
      return (
        <div {...handle}>
          <Table>
            <Table.Head>
              <Table.Row>
                {columns.map((c) => (
                  <Table.Column key={c.key} label={c.label} />
                ))}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {rows.map((row, i) => (
                <Table.Row key={i}>
                  {columns.map((c) => (
                    <Table.Cell key={c.key}>{asString(row[c.key])}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {typeof part.caption === "string" ? <Text className="mt-1 text-xs">{part.caption}</Text> : null}
        </div>
      );
    }
    case "file": {
      const ref = resolveRef?.(part) ?? null;
      const href = ref?.href && SAFE_HREF.test(ref.href) ? ref.href : null;
      return (
        <div {...handle} className="inline-flex items-center gap-2">
          <Badge color="zinc" variant="soft" size="sm">
            {labels.file}
          </Badge>
          {href ? (
            <a href={href} rel="noopener noreferrer" target="_blank" className="underline">
              {asString(part.name)}
            </a>
          ) : (
            <span>{asString(part.name)}</span>
          )}
        </div>
      );
    }
    case "image": {
      const ref = resolveRef?.(part) ?? null;
      const src = ref?.src && (SAFE_HREF.test(ref.src) || SAME_ORIGIN_PATH.test(ref.src)) ? ref.src : null;
      return (
        <div {...handle}>
          {src ? (
            <img src={src} alt={asString(part.alt)} width={typeof part.width === "number" ? part.width : undefined} height={typeof part.height === "number" ? part.height : undefined} className="max-w-full rounded" />
          ) : (
            <Text>{partToText(part, registry)}</Text>
          )}
        </div>
      );
    }
    case "card": {
      const body = (Array.isArray(part.body) ? part.body : []) as Part[];
      const actions = (Array.isArray(part.actions) ? part.actions : []) as { id: string; label: string; kind: string; href?: string }[];
      const fields = (Array.isArray(part.fields) ? part.fields : []) as { label: string; value: string }[];
      return (
        <div {...handle} data-fancy-chat-card-type={asString(part.cardType)}>
          <Card>
            {typeof part.title === "string" ? <Card.Header>{part.title}</Card.Header> : null}
            <Card.Body>
              <div className="flex flex-col gap-2">
                {body.map((child) => (
                  <PartView key={child.id} {...props} part={child} streaming={false} />
                ))}
                {fields.length ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {fields.map((f, i) => (
                      <div key={i} className="contents">
                        <dt className="font-medium">{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </Card.Body>
            {actions.length ? (
              <Card.Footer>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) =>
                    a.kind === "link" && a.href && SAFE_HREF.test(a.href) ? (
                      <a key={a.id} data-fancy-chat-card-action={a.id} href={a.href} rel="noopener noreferrer" target="_blank" className="underline">
                        {a.label}
                      </a>
                    ) : a.kind === "post-back" ? (
                      <Button key={a.id} size="sm" data-fancy-chat-card-action={a.id} onClick={() => onCardAction?.(part, a.id)} disabled={!onCardAction}>
                        {a.label}
                      </Button>
                    ) : null,
                  )}
                </div>
              </Card.Footer>
            ) : null}
          </Card>
        </div>
      );
    }
    case "approval":
    case "question": {
      const hitl = renderHitl ? renderHitl(part) : <Text>{partToText(part, registry)}</Text>;
      // `hidden`, not just empty: an empty wrapper still takes a gap in the message's flex column.
      const hidden = isValidElement(hitl) && hitl.type === HiddenHitl;
      return (
        <div {...handle} hidden={hidden || undefined}>
          {hitl}
        </div>
      );
    }
    default:
      // tool parts render through ToolRow in the thread; anything else falls back to text.
      return (
        <div {...handle} data-fancy-chat-part-unknown="">
          <Badge color="zinc" variant="outline" size="sm" title={labels.unknownPart}>
            {partToText(part, registry)}
          </Badge>
        </div>
      );
  }
}
