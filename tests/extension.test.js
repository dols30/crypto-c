import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { normalizeRequest } from "../extension/client.js";

const source = await readFile(
  new URL("../extension/injected.js", import.meta.url),
  "utf8",
);
const owner = "0x" + "3".repeat(40);
const contract = "0x" + "1".repeat(40);
const spender = "0x" + "2".repeat(40);
const hash = "0x" + "a".repeat(64);
function harness({ providerAtStart = true, timeout = false, rpc } = {}) {
  const listeners = new Map();
  const posts = [];
  const calls = [];
  const original = async (args) => {
    calls.push(args);
    if (rpc) return rpc(args);
    if (args.method === "eth_chainId") return "0x1";
    if (args.method === "eth_accounts") return [owner];
    if (args.method === "eth_sendTransaction") return hash;
    if (args.method === "eth_getTransactionReceipt") return { status: "0x1" };
    if (args.method === "eth_call")
      return (
        "0x" +
        (args.params[0].data.startsWith("0x01ffc9a7") ? "0" : "1").padStart(
          64,
          "0",
        )
      );
    return "read-result";
  };
  const provider = { request: original };
  const window = {
    ethereum: providerAtStart ? provider : undefined,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    postMessage(data) {
      posts.push(data);
    },
  };
  const timers = new Map();
  let timerId = 0;
  const context = {
    window,
    location: { origin: "https://dapp.example" },
    crypto: { randomUUID: () => `request-${++timerId}` },
    structuredClone,
    Event,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout(fn) {
      const id = ++timerId;
      timers.set(id, fn);
      if (timeout) queueMicrotask(fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.runInNewContext(source, context);
  const deliver = (data) =>
    window.dispatchEvent({
      type: "message",
      source: window,
      data: { source: "crypto-c-content", ...data },
    });
  return { provider, window, calls, posts, deliver, timers };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("transaction array is normalized into the backend transaction object", () => {
  const tx = { to: contract, data: "0x" };
  assert.deepEqual(
    normalizeRequest({
      method: "eth_sendTransaction",
      params: [tx],
      chain_id: "0x1",
    }),
    { transaction: tx, method: "eth_sendTransaction", chain_id: 1 },
  );
  assert.throws(() =>
    normalizeRequest({
      method: "eth_sendTransaction",
      params: [],
      chain_id: 1,
    }),
  );
});

test("non-signing reads go straight to the provider", async () => {
  const h = harness();
  assert.equal(
    await h.provider
      .request({ method: "eth_accounts" })
      .then((rows) => rows[0]),
    owner,
  );
  assert.equal(h.posts.length, 0);
});

test("a cancelled high-risk request never reaches the wallet", async () => {
  const h = harness();
  const result = h.provider.request({
    method: "eth_sendTransaction",
    params: [{ to: contract, data: "0x" }],
  });
  await flush();
  h.deliver({ type: "REVIEW_RESULT", id: h.posts[0].id, proceed: false });
  await assert.rejects(result, (error) => error.code === 4001);
  assert.equal(
    h.calls.filter((call) => call.method === "eth_sendTransaction").length,
    0,
  );
});

test("accepted request preserves provider result and original reviewed payload", async () => {
  const h = harness();
  const tx = { to: contract, data: "0x" };
  const result = h.provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  });
  await flush();
  tx.to = spender;
  h.deliver({ type: "REVIEW_RESULT", id: h.posts[0].id, proceed: true });
  assert.equal(await result, hash);
  assert.equal(
    h.calls.find((call) => call.method === "eth_sendTransaction").params[0].to,
    contract,
  );
  assert.equal(h.posts.at(-1).type, "SUBMITTED");
});

test("concurrent requests use separate decisions and ignore unrelated responses", async () => {
  const h = harness();
  const first = h.provider.request({
    method: "eth_sendTransaction",
    params: [{ to: contract }],
  });
  const second = h.provider.request({
    method: "personal_sign",
    params: ["0xab", owner],
  });
  await flush();
  h.deliver({ type: "REVIEW_RESULT", id: "unknown", proceed: true });
  assert.equal(
    h.calls.filter((call) => call.method === "eth_sendTransaction").length,
    0,
  );
  h.deliver({ type: "REVIEW_RESULT", id: h.posts[1].id, proceed: false });
  await assert.rejects(second, (error) => error.code === 4001);
  h.deliver({ type: "REVIEW_RESULT", id: h.posts[0].id, proceed: true });
  assert.equal(await first, hash);
});

test("review timeouts cancel rather than silently forwarding", async () => {
  const h = harness({ timeout: true });
  await assert.rejects(
    h.provider.request({ method: "personal_sign", params: ["0xab", owner] }),
    (error) => error.code === 4001,
  );
  assert.equal(
    h.calls.some((call) => call.method === "personal_sign"),
    false,
  );
});

test("late EIP-6963 providers are also reviewed", async () => {
  const h = harness({ providerAtStart: false });
  h.window.dispatchEvent({
    type: "eip6963:announceProvider",
    detail: { provider: h.provider },
  });
  const result = h.provider.request({
    method: "eth_signTypedData_v4",
    params: [owner, "{}"],
  });
  await flush();
  assert.equal(h.posts[0].payload.method, "eth_signTypedData_v4");
  h.deliver({ type: "REVIEW_RESULT", id: h.posts[0].id, proceed: false });
  await assert.rejects(result);
});

test("revocation validates account, reads allowance and builds zero calldata", async () => {
  const h = harness();
  h.deliver({
    type: "REVOKE_APPROVAL",
    id: "revoke-1",
    approval: { owner, contract, spender, kind: "token", chain_id: 1 },
  });
  await flush();
  const tx = h.calls.find((call) => call.method === "eth_sendTransaction")
    .params[0];
  assert.equal(tx.to, contract);
  assert.equal(tx.from, owner);
  assert.equal(
    tx.data,
    "0x095ea7b3" + spender.slice(2).padStart(64, "0") + "0".repeat(64),
  );
  assert.equal(h.posts.at(-1).result.hash, hash);
});

test("wrong-chain revocation cannot reach the wallet", async () => {
  const h = harness();
  h.deliver({
    type: "REVOKE_APPROVAL",
    id: "revoke-2",
    approval: { owner, contract, spender, kind: "collection", chain_id: 137 },
  });
  await flush();
  assert.equal(
    h.calls.some((call) => call.method === "eth_sendTransaction"),
    false,
  );
  assert.match(h.posts.at(-1).result.error, /original wallet/);
});

test("ERC-721 approve cannot be revoked with ERC-20 zero-allowance calldata", async () => {
  const h = harness({
    rpc: async (args) => {
      if (args.method === "eth_chainId") return "0x1";
      if (args.method === "eth_accounts") return [owner];
      if (args.method === "eth_call") return "0x" + "1".padStart(64, "0");
      return hash;
    },
  });
  h.deliver({
    type: "REVOKE_APPROVAL",
    id: "revoke-3",
    approval: { owner, contract, spender, kind: "token", chain_id: 1 },
  });
  await flush();
  assert.equal(
    h.calls.some((call) => call.method === "eth_sendTransaction"),
    false,
  );
  assert.match(h.posts.at(-1).result.error, /ERC-721/);
});

test("mined receipt plus zero allowance is required before showing revoked", async () => {
  const h = harness({
    rpc: async (args) => {
      if (args.method === "eth_chainId") return "0x1";
      if (args.method === "eth_accounts") return [owner];
      if (args.method === "eth_getTransactionReceipt") return { status: "0x1" };
      if (args.method === "eth_call") return "0x" + "0".repeat(64);
      return hash;
    },
  });
  h.deliver({
    type: "CHECK_APPROVALS",
    id: "check-1",
    approvals: [
      {
        owner,
        contract,
        spender,
        kind: "collection",
        chain_id: 1,
        hash,
        state: "revocation submitted",
      },
    ],
  });
  await flush();
  assert.equal(h.posts.at(-1).result[0].state, "revoked");
});

test("chain changes during allowance reads cannot redirect a revocation", async () => {
  let chainReads = 0;
  const h = harness({
    rpc: async (args) => {
      if (args.method === "eth_chainId")
        return ++chainReads === 1 ? "0x1" : "0x89";
      if (args.method === "eth_accounts") return [owner];
      if (args.method === "eth_call")
        return (
          "0x" +
          (args.params[0].data.startsWith("0x01ffc9a7") ? "0" : "1").padStart(
            64,
            "0",
          )
        );
      return hash;
    },
  });
  h.deliver({
    type: "REVOKE_APPROVAL",
    id: "revoke-chain-change",
    approval: { owner, contract, spender, kind: "token", chain_id: 1 },
  });
  await flush();
  assert.equal(
    h.calls.some((call) => call.method === "eth_sendTransaction"),
    false,
  );
  assert.match(h.posts.at(-1).result.error, /changed/);
});
