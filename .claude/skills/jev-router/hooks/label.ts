/**
 * The footer label. `SessionMode` draws the strings it is handed, so this
 * file's only job is to turn a decision into one of them.
 */

import type { Decision } from "./policy.ts";

/** Below this, the pick is marked so a bad route is visible rather than silent. */
export const LOW_CONFIDENCE = 0.5;

/**
 * The label for the footer, or null to add nothing.
 *
 * Null rather than a placeholder before the first turn: a footer that says
 * nothing reads better than one that says the router has not run yet.
 */
export function labelOf(
  decision: Decision | null,
  enabled: boolean,
): string | null {
  if (!enabled) return "jev off";
  if (!decision) return null;

  const doubt = decision.confidence < LOW_CONFIDENCE ? "?" : "";
  return `jev → ${decision.tier}·${decision.effort}${doubt}`;
}

/** The modes array `SessionMode` should draw, with our label on the end. */
export function withLabel(
  modes: readonly string[],
  label: string | null,
): readonly string[] {
  if (label === null) return modes;
  if (modes.includes(label)) return modes;
  return [...modes, label];
}

/**
 * The status line under the prompt: which model this turn runs on.
 *
 * The app's own model indicator shows the session model and never moves,
 * because the rewrite happens per request. `$.ui.status` is the one place the
 * engine draws on every surface, remote ones included, so this line is what
 * keeps what the person sees in step with what is answering.
 *
 * @param decision the turn's route, or null when the turn is not routed
 * @param sessionModel the main loop's model, what an unrouted turn runs on
 * @param answered the model the API reported, once a step has stopped
 */
export function modelStatusOf(
  decision: Decision | null,
  sessionModel: string,
  answered?: string,
): string {
  if (decision === null) {
    return `모델 ${answered ?? sessionModel} · jev 미적용`;
  }
  const model = answered ?? decision.model;
  // A dated id such as claude-opus-5-20260901 still counts as the one asked for.
  const check =
    answered === undefined ? "" : answered.startsWith(decision.model) ? " ✓" : ` ≠ ${decision.model}`;
  const held = decision.held === undefined ? "" : ` · held:${decision.held}`;
  return `모델 ${decision.tier} · ${model}${check} · ${decision.effort}${held}`;
}
