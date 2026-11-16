import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, Text, Textarea } from "@particle-academy/react-fancy";
import type { ButtonColor } from "@particle-academy/react-fancy";
import { optionTone, type ApprovalOption, type ApprovalRecord, type Decision, type OptionTone } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";
import { PartView, type PartViewProps } from "./PartView";

export interface ApprovalDecisionInput {
  approvalId: string;
  optionId: string;
  decision: Decision;
  note?: string;
  /** For an `edit` option: the human's edited proposal, passed to the server as is. */
  edited?: unknown;
}

export interface ApprovalCardProps {
  record: ApprovalRecord;
  /**
   * Whether this is THE actionable item in the host's coordination scope
   * (fancy-chat-js `pickActionable`). Other cards show their state and wait.
   */
  actionable: boolean;
  /**
   * The human's decision. Return a Promise to hold the in-flight lock until it
   * settles. The server takes the actor from its own resolver: nothing here
   * names who decided.
   */
  onDecide: (input: ApprovalDecisionInput) => void | Promise<unknown>;
  /** Show a note field. Default true. */
  allowNote?: boolean;
  /** Typed approval is opt-in per app; when the host enables it, it passes the hint to show. */
  typedHint?: ReactNode;
  labels?: Partial<ChatLabels>;
  partViewProps?: Omit<PartViewProps, "part">;
}

const TONE_COLOR: Record<OptionTone, ButtonColor> = { positive: "emerald", negative: "red", neutral: "zinc" };

const STATE_COLOR: Record<string, ButtonColor> = {
  pending: "amber",
  deciding: "amber",
  approved: "emerald",
  edited: "emerald",
  applied: "emerald",
  rejected: "zinc",
  "apply-failed": "red",
  withdrawn: "zinc",
  expired: "zinc",
};

/**
 * An approval, rendered from its server record. Button tone and the decision
 * come from each option's KIND, never its label. Options of an unknown kind are
 * not offered. While a decision posts, every option is locked.
 */
export function ApprovalCard(props: ApprovalCardProps): ReactNode {
  const { record, actionable, onDecide, allowNote = true, typedHint, partViewProps } = props;
  const labels = mergeLabels(props.labels);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  // Set on every mount, not only at creation: StrictMode (dev) runs the cleanup
  // and then the effect again, and a ref only the cleanup wrote stayed false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pending = record.state === "pending";
  const options = (record.options ?? [])
    .map((o) => ({ option: o, ...optionTone(o.kind) }))
    .filter((o): o is { option: ApprovalOption; tone: OptionTone; decision: Decision } => o.tone !== null && o.decision !== null);

  const decide = (option: ApprovalOption, decision: Decision) => {
    if (busyRef.current || !actionable || !pending) return;
    busyRef.current = true;
    setBusy(true);
    const trimmed = note.trim();
    const settle = () => {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
    try {
      const result = onDecide({ approvalId: record.approvalId, optionId: option.id, decision, ...(trimmed ? { note: trimmed } : {}) });
      if (result && typeof (result as Promise<unknown>).then === "function") (result as Promise<unknown>).then(settle, settle);
      else settle();
    } catch (error) {
      settle();
      throw error;
    }
  };

  return (
    <div
      data-fancy-chat-approval={record.approvalId}
      data-fancy-chat-approval-state={record.state}
      data-fancy-chat-approval-actionable={actionable && pending ? "true" : "false"}
      data-fancy-chat-approval-busy={busy ? "true" : "false"}
      aria-busy={busy || undefined}
    >
      <Card>
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={STATE_COLOR[record.state] ?? "zinc"} variant="soft" size="sm" data-fancy-chat-approval-status="">
              {labels.approvalStates[record.state] ?? record.state}
            </Badge>
            <span className="font-medium">{record.title}</span>
          </div>
        </Card.Header>
        <Card.Body>
          <div className="flex flex-col gap-2">
            {record.summary ? <Text>{record.summary}</Text> : null}
            {(record.preview ?? []).map((part) => (
              <PartView key={part.id} {...partViewProps} part={part} />
            ))}
            {pending && allowNote ? (
              <div data-fancy-chat-approval-note="">
                <Textarea label={labels.approvalNote} value={note} onValueChange={setNote} disabled={!actionable || busy} minRows={1} autoResize />
              </div>
            ) : null}
            {pending && typedHint ? <div data-fancy-chat-approval-typed-hint="">{typedHint}</div> : null}
            {pending && !actionable ? <Text className="text-xs">{labels.approvalWaiting}</Text> : null}
            {busy ? (
              <Text className="text-xs" aria-live="polite">
                {labels.approvalDeciding}
              </Text>
            ) : null}
            {record.state === "apply-failed" && record.error ? <Text className="text-xs text-red-600">{record.error}</Text> : null}
          </div>
        </Card.Body>
        {pending ? (
          <Card.Footer>
            <div className="flex flex-wrap gap-2">
              {options.map(({ option, tone, decision }) => (
                <Button
                  key={option.id}
                  size="sm"
                  color={TONE_COLOR[tone]}
                  data-fancy-chat-option={option.id}
                  data-fancy-chat-option-kind={option.kind}
                  data-fancy-chat-option-tone={tone}
                  disabled={!actionable || busy}
                  onClick={() => decide(option, decision)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </Card.Footer>
        ) : null}
      </Card>
    </div>
  );
}
