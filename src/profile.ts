import { CORE_PART_KINDS } from "@particle-academy/fancy-chat-js";

import type { ChatLabels } from "./labels";
import type { TriggerDefinition } from "./triggers";

export type SurfaceLayout = "docked" | "overlay" | "page";

/**
 * One surface over the shared engine. MOIC's Compass and Admin chats become two
 * profiles over ONE store, transport and projection, instead of two stacks.
 * The profile id goes to the server, where any filtering is host policy; on the
 * client it only narrows what this surface shows and lets the human act on.
 */
export interface SurfaceProfile {
  id: string;
  /** Part kinds this surface renders in full; anything else renders as its text. Default: every kind. */
  parts?: readonly string[];
  /** HITL kinds this surface lets the human act on. Default both. */
  hitl?: { actionable: readonly ("approval" | "question")[] };
  /** The composer's triggers on this surface. */
  triggers?: readonly TriggerDefinition<never>[];
  /** Which status fields the status line shows. */
  statusFields?: readonly string[];
  layout?: SurfaceLayout;
  labels?: Partial<ChatLabels>;
}

const PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const EXTENSION_KIND = /^x-[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/;

/** Validates a profile once, at definition, so a typo fails loudly instead of hiding a part. */
export function defineSurfaceProfile(profile: SurfaceProfile): Readonly<SurfaceProfile> {
  if (!PROFILE_ID.test(profile.id)) throw new TypeError(`A surface profile id is lower case, up to 64 characters: "${profile.id}".`);
  for (const kind of profile.parts ?? []) {
    if (!(CORE_PART_KINDS as readonly string[]).includes(kind) && !EXTENSION_KIND.test(kind)) {
      throw new TypeError(`Unknown part kind in profile "${profile.id}": "${kind}".`);
    }
  }
  for (const kind of profile.hitl?.actionable ?? []) {
    if (kind !== "approval" && kind !== "question") throw new TypeError(`Unknown HITL kind in profile "${profile.id}": "${String(kind)}".`);
  }
  if (profile.layout && profile.layout !== "docked" && profile.layout !== "overlay" && profile.layout !== "page") {
    throw new TypeError(`Unknown layout in profile "${profile.id}": "${String(profile.layout)}".`);
  }
  return Object.freeze({ ...profile });
}

/** Whether a part kind renders in full on this surface. */
export function profileAllowsPart(profile: SurfaceProfile | undefined, kind: string): boolean {
  return !profile?.parts || profile.parts.includes(kind);
}
