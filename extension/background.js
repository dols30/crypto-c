import {
  requestAPI,
  normalizeRequest,
  approvalKey,
  ADDRESS,
  HASH,
} from "./client.js";

let writes = Promise.resolve();
function writeState(update) {
  const result = writes.then(async () => {
    const state = await chrome.storage.local.get({
      approvals: [],
      reviews: [],
    });
    await chrome.storage.local.set(await update(state));
  });
  writes = result.catch(() => {});
  return result;
}

async function handle(message, sender) {
  if (message.type === "ANALYZE_URL")
    return requestAPI("/api/analyze-url", { url: message.url });
  if (message.type === "REVIEW_REQUEST") {
    const payload = normalizeRequest(message.payload);
    const report = await requestAPI("/api/simulate", payload);
    await writeState((state) => ({
      reviews: [
        {
          ...report,
          origin: sender.origin || sender.url || "",
          reviewed_at: new Date().toISOString(),
        },
        ...state.reviews,
      ].slice(0, 20),
    }));
    return report;
  }
  if (message.type === "APPROVAL_SUBMITTED" && sender.tab) {
    const payload = normalizeRequest(message.payload);
    if (
      payload.method !== "eth_sendTransaction" ||
      !HASH.test(message.hash || "")
    )
      return null;
    // Derive the approval from the submitted request, never from page-supplied report fields.
    const report = await requestAPI("/api/simulate", payload);
    const approval = report.approval;
    if (!approval || !ADDRESS.test(approval.owner)) return null;
    await writeState((state) => {
      const rows = state.approvals.filter(
        (row) => approvalKey(row) !== approvalKey(approval),
      );
      const previous = state.approvals.find(
        (row) => approvalKey(row) === approvalKey(approval),
      );
      return {
        approvals: [
          {
            ...previous,
            ...approval,
            hash: message.hash,
            state: approval.is_revocation
              ? "revocation submitted"
              : "submitted",
            risk_score: report.risk_score,
            origin: sender.origin || "",
            updated_at: new Date().toISOString(),
          },
          ...rows,
        ].slice(0, 50),
      };
    });
    return { saved: true };
  }
  if (message.type === "GET_STATE") {
    await writes;
    return chrome.storage.local.get({ approvals: [], reviews: [] });
  }
  if (message.type === "SYNC_APPROVALS" || message.type === "REVOKE_APPROVAL") {
    // Only extension pages can initiate wallet operations; page bridges cannot.
    if (sender.tab || sender.id !== chrome.runtime.id)
      throw new Error("Use the extension popup.");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id)
      throw new Error("Open the dApp tab with your connected wallet.");
    const state = await chrome.storage.local.get({ approvals: [] });
    if (message.type === "SYNC_APPROVALS") {
      if (!state.approvals.length) return { approvals: [] };
      const updates = await chrome.tabs.sendMessage(tab.id, {
        type: "CHECK_APPROVALS",
        approvals: state.approvals,
      });
      if (!Array.isArray(updates))
        throw new Error(
          updates?.error ||
            "Could not check approvals. Open the connected dApp and reload the extension.",
        );
      await writeState((current) => ({
        approvals: current.approvals.map((row) => {
          const update = updates?.find((item) => item.key === approvalKey(row));
          return update && row.hash === update.hash
            ? { ...row, state: update.state }
            : row;
        }),
      }));
      return chrome.storage.local.get({ approvals: [] });
    }
    const row = state.approvals.find(
      (item) => approvalKey(item) === message.key,
    );
    if (!row || row.state !== "confirmed")
      throw new Error("Refresh and confirm the approval first.");
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "REVOKE_APPROVAL",
      approval: row,
    });
    if (result.error) throw new Error(result.error);
    if (!HASH.test(result.hash || ""))
      throw new Error("The wallet did not return a transaction hash.");
    await writeState((current) => ({
      approvals: current.approvals.map((item) =>
        approvalKey(item) === message.key
          ? {
              ...item,
              hash: result.hash,
              state: "revocation submitted",
              is_revocation: true,
            }
          : item,
      ),
    }));
    return result;
  }
  throw new Error("Unsupported extension request.");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender)
    .then((value) => respond({ ok: true, value }))
    .catch((error) => respond({ ok: false, error: error.message }));
  return true;
});
