import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, CheckboxGroup, RadioGroup, Text, Textarea } from "@particle-academy/react-fancy";
import { canSubmitAnswer, type AnswerDraft, type QuestionRecord } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";

export interface QuestionAnswerInput extends AnswerDraft {
  questionId: string;
}

export interface QuestionFormProps {
  question: QuestionRecord;
  /** Controlled: the host keeps a draft per question (and across threads). */
  draft: AnswerDraft;
  onDraftChange: (draft: AnswerDraft) => void;
  /** The human's answer. Return a Promise to hold the in-flight lock. No actor is sent. */
  onSubmit: (input: QuestionAnswerInput) => void | Promise<unknown>;
  /** Whether this is THE actionable item in the host's scope. */
  actionable: boolean;
  onLater?: (questionId: string) => void;
  onDismiss?: (questionId: string) => void;
  labels?: Partial<ChatLabels>;
}

/**
 * A question from its server record. Answer is enabled once every required
 * field has an option or (when the question allows) a note: the same rule as
 * fancy-chat-js `canSubmitAnswer`, which the server applies again.
 */
export function QuestionForm(props: QuestionFormProps): ReactNode {
  const { question, draft, onDraftChange, onSubmit, actionable, onLater, onDismiss } = props;
  const labels = mergeLabels(props.labels);
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

  const open = (question.state ?? "open") === "open";
  const check = canSubmitAnswer(question, draft);
  const disabled = !actionable || busy;

  const setValue = (id: string, value: unknown) => onDraftChange({ values: { ...draft.values, [id]: value }, notes: { ...draft.notes } });
  const setNote = (id: string, note: string) => onDraftChange({ values: { ...draft.values }, notes: { ...draft.notes, [id]: note } });

  const submit = () => {
    if (busyRef.current || disabled || !check.ok || !open) return;
    busyRef.current = true;
    setBusy(true);
    const settle = () => {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    };
    const result = onSubmit({ questionId: question.questionId, values: draft.values, notes: draft.notes });
    if (result && typeof (result as Promise<unknown>).then === "function") (result as Promise<unknown>).then(settle, settle);
    else settle();
  };

  return (
    <div
      data-fancy-chat-question={question.questionId}
      data-fancy-chat-question-state={question.state ?? "open"}
      data-fancy-chat-question-actionable={actionable && open ? "true" : "false"}
      aria-busy={busy || undefined}
    >
      <Card>
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={open ? "amber" : "emerald"} variant="soft" size="sm">
              {open ? labels.question : labels.questionAnswered}
            </Badge>
            <span className="font-medium">{question.prompt}</span>
          </div>
        </Card.Header>
        {open ? (
          <>
            <Card.Body>
              <div className="flex flex-col gap-3">
                {question.fields.map((field) => {
                  const value = draft.values[field.id];
                  const options = (field.options ?? []).map((o) => ({ value: o.id, label: o.label }));
                  return (
                    <div key={field.id} data-fancy-chat-field={field.id} data-fancy-chat-field-type={field.type} className="flex flex-col gap-1">
                      {field.type === "single" ? (
                        <RadioGroup label={field.label} required={field.required} list={options} value={typeof value === "string" ? value : undefined} onValueChange={(v) => setValue(field.id, v)} disabled={disabled} orientation="vertical" />
                      ) : field.type === "multi" ? (
                        <CheckboxGroup label={field.label} required={field.required} list={options} value={Array.isArray(value) ? (value as string[]) : []} onValueChange={(v) => setValue(field.id, v)} disabled={disabled} orientation="vertical" />
                      ) : (
                        <Textarea label={field.label} required={field.required} value={typeof value === "string" ? value : ""} onValueChange={(v) => setValue(field.id, v)} disabled={disabled} minRows={1} autoResize />
                      )}
                      {question.allowNote && field.type !== "text" ? (
                        <div data-fancy-chat-field-note={field.id}>
                          <Textarea label={labels.questionNote} value={draft.notes[field.id] ?? ""} onValueChange={(v) => setNote(field.id, v)} disabled={disabled} minRows={1} autoResize />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!actionable ? <Text className="text-xs">{labels.questionWaiting}</Text> : null}
              </div>
            </Card.Body>
            <Card.Footer>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" color="brand" data-fancy-chat-question-submit="" disabled={disabled || !check.ok} onClick={submit}>
                  {labels.questionSubmit}
                </Button>
                {onLater ? (
                  <Button size="sm" variant="ghost" data-fancy-chat-question-later="" onClick={() => onLater(question.questionId)}>
                    {labels.questionLater}
                  </Button>
                ) : null}
                {onDismiss ? (
                  <Button size="sm" variant="ghost" data-fancy-chat-question-dismiss="" onClick={() => onDismiss(question.questionId)}>
                    {labels.questionDismiss}
                  </Button>
                ) : null}
              </div>
            </Card.Footer>
          </>
        ) : null}
      </Card>
    </div>
  );
}
