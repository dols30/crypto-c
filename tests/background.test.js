import { test } from "node:test";
import assert from "node:assert/strict";

const owner = "0x" + "3".repeat(40);
const contract = "0x" + "1".repeat(40);
const spender = "0x" + "2".repeat(40);
const hash = "0x" + "a".repeat(64);
const report = {
  status: "critical",
  risk_score: 95,
  operation: "Unlimited token approval",
  summary: "Unlimited allowance",
  approval: {
    owner,
    contract,
    spender,
    chain_id: 1,
    kind: "token",
    amount: "999",
    is_revocation: false,
  },
};
const sender = {
  id: "crypto-c",
  tab: { id: 12 },
  origin: "https://dapp.example",
};
let instance = 0;
async function start({
  failAPI = false,
  initial = {},
  sessionStore = {},
} = {}) {
  let listener;
  let click;
  let sent = [];
  let rows = { approvals: [], reviews: [], ...structuredClone(initial) };
  let apiPayload;
  globalThis.chrome = {
    action: {
      onClicked: {
        addListener(fn) {
          click = fn;
        },
      },
      async setBadgeText() {},
      async setTitle() {},
    },
    runtime: {
      id: "crypto-c",
      getURL(path) {
        return `chrome-extension://crypto-c/${path}`;
      },
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
    storage: {
      session: {
        async get(defaults) {
          return { ...defaults, ...structuredClone(sessionStore) };
        },
        async set(update) {
          Object.assign(sessionStore, structuredClone(update));
        },
      },
      local: {
        async get(defaults) {
          return { ...defaults, ...structuredClone(rows) };
        },
        async set(update) {
          rows = { ...rows, ...structuredClone(update) };
        },
      },
    },
    tabs: {
      onRemoved: { addListener() {} },
      async query() {
        return [{ id: 12 }];
      },
      async sendMessage(tabId, message, options) {
        sent.push({ tabId, message, options });
        if (message.type === "TOGGLE_PANEL") return { opened: true };
        return [];
      },
    },
  };
  globalThis.fetch = async (_url, init) => {
    if (failAPI) throw new Error("Backend offline");
    apiPayload = JSON.parse(init.body);
    return new Response(JSON.stringify(report), { status: 200 });
  };
  await import(`../extension/background.js?instance=${++instance}`);
  const send = (message, from = sender) =>
    new Promise((resolve) => listener(message, from, resolve));
  return { send, click, sent, state: () => rows, payload: () => apiPayload };
}
const payload = {
  method: "eth_sendTransaction",
  params: [{ from: owner, to: contract, data: "0x" }],
  chain_id: "0x1",
};

test("backend failures surface an unavailable response without fabricated risk", async () => {
  const h = await start({ failAPI: true });
  const response = await h.send({ type: "REVIEW_REQUEST", payload });
  assert.equal(response.ok, false);
  assert.match(response.error, /offline/);
  assert.equal(h.state().reviews.length, 0);
});

test("actual transaction params are reviewed and summary is persisted", async () => {
  const h = await start();
  const response = await h.send({ type: "REVIEW_REQUEST", payload });
  assert.equal(response.ok, true);
  assert.equal(h.payload().transaction.to, contract);
  assert.equal(h.state().reviews[0].risk_score, 95);
  assert.equal(h.state().reviews[0].origin, sender.origin);
});

test("submission starts pending and rechecks approval fields rather than trusting page report", async () => {
  const h = await start();
  const response = await h.send({
    type: "APPROVAL_SUBMITTED",
    payload,
    hash,
    approval: { spender: "fake" },
  });
  assert.equal(response.ok, true);
  assert.equal(h.state().approvals[0].spender, spender);
  assert.equal(h.state().approvals[0].state, "submitted");
  const saved = await h.send({ type: "GET_STATE" }, { id: "crypto-c" });
  assert.equal(saved.value.approvals[0].hash, hash);
});

test("invalid transaction hashes cannot create an approval record", async () => {
  const h = await start();
  await h.send({ type: "APPROVAL_SUBMITTED", payload, hash: "invented-hash" });
  assert.equal(h.state().approvals.length, 0);
});

test("page message senders cannot request a wallet revocation", async () => {
  const h = await start();
  const response = await h.send({ type: "REVOKE_APPROVAL", key: "anything" });
  assert.equal(response.ok, false);
  assert.match(response.error, /popup/);
});

test("pending permissions cannot be revoked before their status is confirmed", async () => {
  const row = { ...report.approval, state: "submitted", hash };
  const h = await start({ initial: { approvals: [row] } });
  const key = [1, owner, contract, spender].join(":");
  const response = await h.send(
    { type: "REVOKE_APPROVAL", key },
    { id: "crypto-c" },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /confirm the approval/);
});

test("toolbar panel is bound to its page and can refresh observed permissions", async () => {
  const h = await start();
  await h.click({ id: 12, url: "https://dapp.example" });
  const url = h.sent[0].message.url;
  const panelToken = new URL(url).searchParams.get("panel");
  const frame = {
    id: "crypto-c",
    tab: { id: 12, url: "https://dapp.example" },
    frameId: 3,
    url,
  };
  const context = await h.send({ type: "PANEL_CONTEXT", panelToken }, frame);
  assert.equal(context.value.url, "https://dapp.example");
  assert.equal(
    (await h.send({ type: "SYNC_APPROVALS", panelToken }, frame)).ok,
    true,
  );
  assert.equal(
    (await h.send({ type: "CLOSE_PANEL", panelToken }, frame)).ok,
    true,
  );
  assert.equal(h.sent.at(-1).message.type, "CLOSE_PANEL");
  assert.equal(
    (await h.send({ type: "GET_STATE", panelToken }, frame)).ok,
    false,
  );
});

test("an arbitrary embedded extension page cannot read state or request wallet actions", async () => {
  const h = await start();
  await h.click({ id: 12 });
  const url = h.sent[0].message.url;
  const panelToken = new URL(url).searchParams.get("panel");
  const frame = { id: "crypto-c", tab: { id: 99 }, frameId: 3, url };
  assert.equal(
    (await h.send({ type: "GET_STATE", panelToken }, frame)).ok,
    false,
  );
  assert.equal(
    (await h.send({ type: "REVOKE_APPROVAL", panelToken }, frame)).ok,
    false,
  );
  assert.equal(
    (await h.send({ type: "GET_STATE" }, { ...frame, tab: { id: 12 } })).ok,
    false,
  );
});

test("an open panel remains authorized after the service worker restarts", async () => {
  const sessionStore = {};
  const first = await start({ sessionStore });
  await first.click({ id: 12 });
  const url = first.sent[0].message.url;
  const panelToken = new URL(url).searchParams.get("panel");
  const frame = { id: "crypto-c", tab: { id: 12 }, frameId: 3, url };
  assert.equal(
    (await first.send({ type: "GET_STATE", panelToken }, frame)).ok,
    true,
  );
  const restarted = await start({ sessionStore });
  assert.equal(
    (await restarted.send({ type: "GET_STATE", panelToken }, frame)).ok,
    true,
  );
  assert.equal(
    (
      await restarted.send(
        { type: "GET_STATE", panelToken },
        { ...frame, frameId: 4 },
      )
    ).ok,
    false,
  );
});
