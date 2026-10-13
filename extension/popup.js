import { requestAPI, shortAddress, approvalKey } from "./client.js";

const $ = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll("[data-tab]")];
let state = { approvals: [], reviews: [] };
let selectedTab = "overview";
const panelToken = new URLSearchParams(location.search).get("panel");
const closePanel = () => send({ type: "CLOSE_PANEL" }).catch(() => {});
$("close-panel").onclick = closePanel;
$("close-panel").hidden = !panelToken;

async function send(message) {
  const result = await chrome.runtime.sendMessage({ ...message, panelToken });
  if (!result?.ok) throw new Error(result?.error || "Extension unavailable.");
  return result.value;
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function icon(name, className = "") {
  const node = text("span", undefined, `icon ${className}`);
  node.dataset.icon = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}
function level(score) {
  return score == null
    ? "unknown"
    : score >= 80
      ? "danger"
      : score >= 30
        ? "warning"
        : "low";
}
function showTab(name, focus = false) {
  selectedTab = name;
  for (const button of tabs) {
    const selected = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`${button.dataset.tab}-panel`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  document.querySelector(".panels").scrollTop = 0;
}
for (const button of tabs) {
  button.onclick = () => showTab(button.dataset.tab);
  button.onkeydown = (event) => {
    const index = tabs.indexOf(button);
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      showTab(tabs[next].dataset.tab, true);
    }
  };
}
$("view-activity").onclick = () => showTab("activity", true);
function showSettings(open) {
  $("main-view").hidden = open;
  $("settings-view").hidden = !open;
  $("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("settings-back").focus();
  else {
    showTab(selectedTab);
    $("settings-toggle").focus();
  }
}
$("settings-toggle").onclick = () => showSettings($("settings-view").hidden);
$("settings-back").onclick = () => showSettings(false);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("settings-view").hidden && panelToken) {
    event.preventDefault();
    closePanel();
  }
  if (event.key === "Escape" && !$("settings-view").hidden) {
    event.preventDefault();
    showSettings(false);
  }
});

function setRisk(score, summary) {
  const risk = level(score);
  document.body.dataset.risk = risk;
  $("risk-score").textContent = score == null ? "…" : String(Math.round(score));
  const wording = {
    low: ["Low indicators", "No warning", "signs found."],
    warning: ["Review recommended", "Take a", "closer look."],
    danger: ["High risk", "Review this", "destination."],
    unknown: ["Not reviewed", "Review", "unavailable."],
  }[risk];
  $("risk-label").textContent = wording[0];
  $("risk-title").replaceChildren(
    document.createTextNode(wording[1]),
    document.createElement("br"),
    document.createTextNode(wording[2]),
  );
  $("risk-symbol").dataset.icon =
    risk === "danger" || risk === "warning"
      ? "shield-warning"
      : risk === "unknown"
        ? "link-break"
        : "shield-check";
  $("site-details").textContent = summary;
  document.querySelector(".risk-hero").setAttribute("aria-busy", "false");
}
async function checkEngine() {
  try {
    await requestAPI("/api/health");
    $("status").textContent = "Local engine connected";
    $("engine-status").className = "engine-status online";
  } catch (_) {
    $("status").textContent = "Local engine offline";
    $("engine-status").className = "engine-status offline";
  }
}
async function scan() {
  $("rescan").disabled = true;
  document.querySelector(".risk-hero").setAttribute("aria-busy", "true");
  $("risk-label").textContent = "Checking website";
  try {
    const tab = panelToken
      ? await send({ type: "PANEL_CONTEXT" })
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      $("site-url").textContent = "Not a web page";
      $("site-url").title = "";
      throw new Error("Open an HTTP or HTTPS website to review its hostname.");
    }
    $("site-url").textContent = new URL(tab.url).hostname;
    $("site-url").title = tab.url;
    const report = await send({ type: "ANALYZE_URL", url: tab.url });
    const score = Number(report.risk_score);
    if (!Number.isFinite(score) || score < 0 || score > 100)
      throw new Error("The local engine returned an invalid score.");
    setRisk(
      score,
      score < 30
        ? "Hostname checks only. Not a safety guarantee."
        : report.details,
    );
  } catch (error) {
    setRisk(null, error.message);
  } finally {
    $("rescan").disabled = false;
    checkEngine();
  }
}
function emptyState(name, heading, description) {
  const root = text("div", undefined, "large-empty");
  const symbol = text("span", undefined, "empty-symbol");
  symbol.append(icon(name));
  root.append(symbol, text("h4", heading), text("p", description));
  return root;
}
function riskChip(report) {
  return text(
    "span",
    `${report.risk_score}/100`,
    `risk-chip ${level(report.risk_score)}`,
  );
}
function reviewHeading(report) {
  const row = text("div", undefined, "history-heading");
  row.append(text("span", report.operation, "history-title"), riskChip(report));
  return row;
}
function renderReviews() {
  $("activity-count").textContent = state.reviews.length;
  $("activity-count").hidden = state.reviews.length === 0;
  const latest = state.reviews[0];
  const preview = $("latest-review");
  preview.className = latest ? "review-preview has-review" : "review-preview";
  preview.replaceChildren();
  if (latest) {
    preview.append(
      reviewHeading(latest),
      text("p", latest.summary, "review-summary"),
    );
  } else {
    const symbol = text("span", undefined, "empty-symbol");
    symbol.append(icon("signature"));
    const copy = text("div");
    copy.append(
      text("h4", "No wallet requests yet."),
      text("p", "Connect on a dApp to review requests."),
    );
    preview.append(symbol, copy);
  }
  const history = $("review-history");
  history.replaceChildren();
  if (!state.reviews.length)
    history.append(
      emptyState(
        "clock-counter-clockwise",
        "A clean slate.",
        "Your last 20 wallet reviews will be kept here, on this browser.",
      ),
    );
  for (const report of state.reviews) {
    const item = text("article", undefined, "history-item");
    item.append(
      reviewHeading(report),
      text("p", report.summary, "review-summary"),
    );
    const time = new Date(report.reviewed_at);
    const label = Number.isNaN(time.getTime())
      ? ""
      : time.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    const origin = report.origin || "Wallet request";
    item.append(
      text("div", [origin, label].filter(Boolean).join(" · "), "review-meta"),
    );
    history.append(item);
  }
}
function renderApprovals() {
  $("permission-count").textContent = state.approvals.length;
  $("permission-count").hidden = state.approvals.length === 0;
  const list = $("approvals-list");
  list.replaceChildren();
  if (!state.approvals.length)
    list.append(
      emptyState(
        "key",
        "No permissions observed.",
        "Approvals you submit while Crypto-C is active will appear here. Existing wallet history is not imported.",
      ),
    );
  for (const row of state.approvals) {
    const item = text("article", undefined, "approval-item");
    const heading = text("div", undefined, "approval-heading");
    heading.append(
      text(
        "span",
        row.kind === "collection" ? "Collection access" : "Token permission",
        "approval-title",
      ),
      text("span", row.state, "approval-state"),
    );
    item.append(
      heading,
      text(
        "div",
        `Contract ${shortAddress(row.contract)} · Chain ${row.chain_id}`,
        "approval-meta",
      ),
      text("div", `Spender ${shortAddress(row.spender)}`, "approval-meta"),
    );
    const actions = text("div", undefined, "approval-actions");
    let amount = "Observed permission";
    try {
      amount =
        row.kind === "collection"
          ? "Collection-wide access"
          : BigInt(row.amount) === 2n ** 256n - 1n
            ? "Unlimited allowance"
            : "Amount / token ID: " + row.amount;
    } catch (_) {
      /* Keep the record readable if a stale amount is invalid. */
    }
    const revoke = text("button", "Revoke in wallet", "revoke-button");
    revoke.type = "button";
    revoke.disabled = row.state !== "confirmed";
    revoke.title = revoke.disabled
      ? "Refresh on the matching dApp to confirm this permission first."
      : "Prepare a revocation for wallet confirmation";
    revoke.onclick = async () => {
      revoke.disabled = true;
      $("approval-message").textContent =
        "Review the revocation in your wallet. It is complete only after chain confirmation.";
      try {
        const result = await send({
          type: "REVOKE_APPROVAL",
          key: approvalKey(row),
        });
        $("approval-message").textContent =
          `Submitted ${shortAddress(result.hash)}. Refresh after confirmation.`;
      } catch (error) {
        $("approval-message").textContent = error.message;
      }
      try {
        await loadState();
      } catch (error) {
        $("approval-message").textContent = error.message;
      }
    };
    actions.append(text("span", amount, "approval-amount"), revoke);
    item.append(actions);
    list.append(item);
  }
}
async function loadState() {
  const result = await send({ type: "GET_STATE" });
  state = {
    approvals: Array.isArray(result.approvals) ? result.approvals : [],
    reviews: Array.isArray(result.reviews) ? result.reviews : [],
  };
  renderApprovals();
  renderReviews();
}
$("rescan").onclick = scan;
$("refresh-approvals").onclick = async () => {
  $("refresh-approvals").disabled = true;
  $("approval-message").textContent =
    "Checking permissions with the connected wallet…";
  try {
    await send({ type: "SYNC_APPROVALS" });
    await loadState();
    $("approval-message").textContent = state.approvals.length
      ? "Refresh complete. Pending records may need the original wallet account and chain."
      : "No observed permissions to check yet.";
  } catch (error) {
    $("approval-message").textContent = error.message;
  } finally {
    $("refresh-approvals").disabled = false;
  }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.approvals || changes.reviews))
    loadState().catch(() => {});
});
scan();
loadState().catch((error) => {
  $("approval-message").textContent = error.message;
});
