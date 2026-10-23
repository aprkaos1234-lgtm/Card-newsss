/**
 * Local checks that run before Jev is asked anything. Nothing here touches
 * the network, so a turn these catch never leaves the machine.
 *
 * - A turn carrying something that looks like a secret is not sent to Jev.
 * - A turn that names a model is routed to that model without asking Jev.
 * - What Jev does see is only the typed request: harness blocks and code
 *   are cut out, and the rest is capped in length.
 */

import { MODEL_OF, type Decision, type Effort, type Tier } from "./policy.ts";

/** The most characters of a request Jev is ever shown. */
export const MAX_STATE_CHARS = 2000;

/**
 * Shapes of common credentials. Deliberately broad: a false positive only
 * means one turn runs on the session model, a false negative sends a secret
 * out.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)[A-Z ]*-----/,
  /\bsk-(ant|proj|live|test)?[-_]?[A-Za-z0-9_-]{16,}/,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/i,
  /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp)s?:\/\/\S+/i,
  /\b(api[_-]?key|secret|token|passw(or)?d|pwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|access[_-]?token|private[_-]?key|service[_-]?role)\b["']?\s*[:=]\s*["']?[^\s"']{8,}/i,
  /(비밀번호|패스워드|토큰|시크릿|API\s*키)\s*[:=은는]\s*\S{8,}/i,
  /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/,
];

/** Whether the text looks like it carries a credential. */
export function hasSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

type Explicit = { tier: Tier; effort: Effort };

/**
 * A model the person named in the request, which beats anything Jev would
 * say. Fable is only ever reached this way.
 */
const EXPLICIT: readonly { pattern: RegExp; pick: Explicit }[] = [
  {
    pattern:
      /((최고|가장\s*좋은)\s*(급\s*)?모델\s*(로|으로|써|사용)|\buse\s+(the\s+)?(best|top)\s+model\b|\buse\s+fable\b|\bfable\s*(로|으로)|페이블\s*(로|으로)|#fable\b)/i,
    pick: { tier: "fable", effort: "high" },
  },
  {
    pattern: /(\buse\s+opus\b|\bwith\s+opus\b|\bopus\s*(로|으로|에서)|오퍼스\s*(로|으로)|#opus\b)/i,
    pick: { tier: "opus", effort: "high" },
  },
  {
    pattern: /(\buse\s+sonnet\b|\bwith\s+sonnet\b|\bsonnet\s*(로|으로|에서)|소넷\s*(로|으로)|#sonnet\b)/i,
    pick: { tier: "sonnet", effort: "medium" },
  },
  {
    pattern:
      /(\buse\s+haiku\b|\bwith\s+haiku\b|\bhaiku\s*(로|으로|에서)|하이쿠\s*(로|으로)|#haiku\b|가벼운\s*모델|싼\s*모델|저렴한\s*모델)/i,
    pick: { tier: "haiku", effort: "medium" },
  },
];

/** The decision for a model the person named, or null when none was. */
export function explicitDecision(text: string): Decision | null {
  const typed = typedOf(text);
  for (const { pattern, pick } of EXPLICIT) {
    if (pattern.test(typed)) {
      return {
        tier: pick.tier,
        model: MODEL_OF[pick.tier],
        effort: pick.effort,
        confidence: 1,
      };
    }
  }
  return null;
}

/** The request with harness blocks removed, before any code is cut. */
function typedOf(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<system-note>[\s\S]*?<\/system-note>/g, " ")
    .replace(/<previous-body>[\s\S]*?<\/previous-body>/g, " ");
}

/**
 * What Jev is shown: the typed request only. Code blocks become a marker, so
 * Jev knows code was pasted without seeing it, and the whole is capped.
 */
export function minimizedState(text: string): string {
  const cut = typedOf(text)
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/\s+/g, " ")
    .trim();
  return cut.length > MAX_STATE_CHARS ? cut.slice(0, MAX_STATE_CHARS) : cut;
}
