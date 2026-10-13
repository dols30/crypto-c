import { riskLabel, shortAddress, approvalKey } from "./client.js";
const $ = (id) => document.getElementById(id);
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "Extension unavailable.");
  return result.value;
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
async function scan() {
  $("rescan").disabled = true;
  $("status").textContent = "Checking…";
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url || !/^https?:/.test(tab.url))
      throw new Error("Open an HTTP or HTTPS website to run a check.");
    $("site-url").textContent = new URL(tab.url).hostname;
    const report = await send({ type: "ANALYZE_URL", url: tab.url });
    $("risk-score").textContent = `${report.risk_score}/100`;
    $("risk-score").className =
      `score ${report.risk_score >= 80 ? "high" : report.risk_score >= 30 ? "medium" : "low"}`;
    $("risk-label").textContent = riskLabel(report.risk_score);
    $("site-details").textContent = report.details;
    $("status").textContent = "Backend connected";
  } catch (error) {
    $("risk-score").textContent = "—";
    $("risk-label").textContent = "Not reviewed";
    $("site-details").textContent = error.message;
    $("status").textContent = "Review unavailable";
  } finally {
    $("rescan").disabled = false;
  }
}
async function loadState() {
  const state = await send({ type: "GET_STATE" });
  $("approvals-list").replaceChildren();
  if (!state.approvals.length)
    $("approvals-list").append(
      text(
        "div",
        "No approvals observed. Crypto-C does not import your full wallet history.",
        "empty-state",
      ),
    );
  for (const row of state.approvals) {
    const item = document.createElement("div");
    item.className = "approval-item";
    item.append(
      text(
        "div",
        row.kind === "collection" ? "Collection access" : "Token permission",
        "approval-title",
      ),
      text(
        "div",
        `Contract ${shortAddress(row.contract)} · Chain ${row.chain_id}`,
        "approval-meta",
      ),
      text("div", `Spender ${shortAddress(row.spender)}`, "approval-meta"),
    );
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const revoke = text("button", "Revoke in wallet", "revoke-button");
    revoke.disabled = row.state !== "confirmed";
    revoke.onclick = async () => {
      revoke.disabled = true;
      $("approval-message").textContent =
        "Review the revocation in your wallet. It is not complete until confirmed on-chain.";
      try {
        const result = await send({
          type: "REVOKE_APPROVAL",
          key: approvalKey(row),
        });
        $("approval-message").textContent =
          `Revocation submitted: ${shortAddress(result.hash)}. Refresh after confirmation.`;
      } catch (error) {
        $("approval-message").textContent = error.message;
      }
      await loadState();
    };
    actions.append(text("span", row.state, "approval-state"), revoke);
    item.append(actions);
    $("approvals-list").append(item);
  }
  const report = state.reviews[0];
  if (report)
    $("latest-review").textContent =
      `${report.operation} · ${report.risk_score}/100. ${report.summary}`;
}
$("rescan").onclick = scan;
$("refresh-approvals").onclick = async () => {
  $("refresh-approvals").disabled = true;
  $("approval-message").textContent =
    "Checking observed approvals against the connected wallet…";
  try {
    await send({ type: "SYNC_APPROVALS" });
    $("approval-message").textContent =
      "Status checked for matching accounts and chains. Switch your wallet to the original chain if an approval is still pending.";
    await loadState();
  } catch (error) {
    $("approval-message").textContent = error.message;
  } finally {
    $("refresh-approvals").disabled = false;
  }
};
scan();
loadState().catch((error) => {
  $("approval-message").textContent = error.message;
});
