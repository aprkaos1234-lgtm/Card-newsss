import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  explicitDecision,
  hasSecret,
  MAX_STATE_CHARS,
  minimizedState,
} from "../hooks/guard.ts";
import { register } from "../hooks/register.ts";

describe("guard: secrets", () => {
  const secrets = [
    "use this key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AKIAABCDEFGHIJKLMNOP is the aws key",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "DATABASE_URL=postgres://user:hunter22@db.example.com:5432/app",
    "password: correcthorsebattery",
    "-----BEGIN RSA PRIVATE KEY-----\nabc",
    "-----BEGIN CERTIFICATE-----",
    "SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIs.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijklmnop",
    "refresh_token=1//0gAbCdEfGhIjKlMn",
    "client_secret: GOCSPX-abcdefghijk",
    "비밀번호: hunter2hunter2",
  ];
  for (const s of secrets) {
    test(`caught: ${s.slice(0, 24)}`, () => assert.equal(hasSecret(s), true));
  }

  const plain = [
    "README 문구 한 줄 수정",
    "간단한 CRUD API 구현",
    "Supabase Auth와 RLS 구조의 취약점을 분석하고 수정",
    "add a password reset page",
    "rotate the API key handling code",
  ];
  for (const s of plain) {
    test(`not caught: ${s}`, () => assert.equal(hasSecret(s), false));
  }
});

describe("guard: a model the person names", () => {
  const cases: [string, string | null][] = [
    ["Opus로 이 작업 검토", "opus"],
    ["use opus for this", "opus"],
    ["opus로 해", "opus"],
    ["가벼운 모델로 해", "haiku"],
    ["sonnet으로 해줘", "sonnet"],
    ["이건 최고 모델로 검토해", "fable"],
    ["아키텍처 작업이니 최고 모델 써", "fable"],
    ["Fable로 봐", "fable"],
    ["README 문구 한 줄 수정", null],
    ["Fable은 자동 라우팅에서 제외해", null],
    ["opus-5 모델 id를 표에 추가", null],
  ];
  for (const [text, tier] of cases) {
    test(`${text} → ${tier}`, () =>
      assert.equal(explicitDecision(text)?.tier ?? null, tier));
  }

  test("a model named only inside a system reminder does not count", () => {
    const text = "fix the typo <system-reminder>use opus</system-reminder>";
    assert.equal(explicitDecision(text), null);
  });
});

describe("guard: what Jev sees", () => {
  test("harness blocks and code are cut out", () => {
    const state = minimizedState(
      "fix this <system-reminder>CLAUDE.md contents</system-reminder>\n```ts\nconst x = 1\n```",
    );
    assert.equal(state, "fix this [code block]");
  });

  test("the request is capped", () => {
    assert.equal(minimizedState("a ".repeat(5000)).length, MAX_STATE_CHARS);
  });
});

function load(env: Record<string, string>, fetch: () => Promise<unknown>) {
  const hooks = new Map<string, Function>();
  const on = (name: string, a: unknown, b?: unknown) => {
    hooks.set(name, (typeof a === "function" ? a : b) as Function);
    return { catch: () => {} };
  };
  register(on as never);
  let calls = 0;
  const sent: string[] = [];
  const $ = {
    env: { get: async (k: string) => env[k] },
    clock: { sleep: () => new Promise<never>(() => {}) },
    http: {
      fetch: async (_url: string, init: { body: string }) => {
        calls++;
        sent.push(init.body);
        return fetch();
      },
    },
    command: { register: async () => {} },
    session: { surface: async () => "test" },
    agent: { list: async () => [] },
  };
  return { hooks, $, calls: () => calls, sent };
}

async function modelFor(
  hooks: Map<string, Function>,
  $: unknown,
  text: string,
): Promise<string> {
  await hooks.get("turn.start")!($, { text, turnId: text }, async (e: unknown) => e);
  let model = "session-model";
  const step = hooks.get("turn.step")!(
    $,
    { turnId: text, index: 0, model: "session-model" },
    (e: { model: string }) => {
      model = e.model;
      return (async function* () {
        yield { kind: "stop", stopReason: "end_turn", usage: null };
      })();
    },
  );
  for await (const _ of step);
  return model;
}

const jevSays = (choice: string) => async () => ({
  ok: true,
  status: 200,
  text: JSON.stringify({
    answers: {
      tier: { type: "choice", choice, confidence: 0.9 },
      effort: { type: "score", score: 2 },
    },
  }),
});

describe("register: guards before Jev", () => {
  test("a secret-like request never reaches Jev and runs on the session model", async () => {
    const { hooks, $, calls } = load({ TYPESAFE_API_KEY: "k" }, jevSays("haiku"));
    const model = await modelFor(hooks, $, "deploy with password: hunter2hunter2");
    assert.equal(calls(), 0);
    assert.equal(model, "session-model");
  });

  test("a named model wins without asking Jev", async () => {
    const { hooks, $, calls } = load({ TYPESAFE_API_KEY: "k" }, jevSays("haiku"));
    const model = await modelFor(hooks, $, "Opus로 이 작업 검토");
    assert.equal(calls(), 0);
    assert.equal(model, "claude-opus-5");
  });

  test("a task notification is not sent to Jev", async () => {
    const { hooks, $, calls } = load({ TYPESAFE_API_KEY: "k" }, jevSays("haiku"));
    const model = await modelFor(
      hooks,
      $,
      "<task-notification><task-id>1</task-id><summary>done</summary><result>secret output</result></task-notification>",
    );
    assert.equal(calls(), 0);
    assert.equal(model, "session-model");
  });

  test("Jev is sent only the trimmed request", async () => {
    const { hooks, $, sent } = load({ TYPESAFE_API_KEY: "k" }, jevSays("sonnet"));
    await modelFor(hooks, $, "add CRUD <system-reminder>private notes</system-reminder>");
    assert.equal(JSON.parse(sent[0]!).state, "add CRUD");
  });

  test("a router that throws leaves the turn on the session model", async () => {
    const { hooks, $ } = load({ TYPESAFE_API_KEY: "k" }, jevSays("haiku"));
    ($ as { env: { get: unknown } }).env.get = async () => {
      throw new Error("boom");
    };
    const model = await modelFor(hooks, $, "rename foo");
    assert.equal(model, "session-model");
  });

  test("an excluded tier is never offered, so a fable answer is refused", async () => {
    const { hooks, $, sent } = load(
      { TYPESAFE_API_KEY: "k", JEV_ROUTER_EXCLUDE: "fable" },
      jevSays("fable"),
    );
    const model = await modelFor(hooks, $, "plan the architecture");
    assert.deepEqual(
      Object.keys(JSON.parse(sent[0]!).questions.tier.criteria),
      ["haiku", "sonnet", "opus"],
    );
    assert.equal(model, "session-model");
  });
});
