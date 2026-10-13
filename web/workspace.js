import { requestAPI, riskLabel, shortAddress } from "/extension/client.js";
const $ = (id) => document.getElementById(id);
const history = [];
const contract = "0x1111111111111111111111111111111111111111";
const spender = "2222222222222222222222222222222222222222".padStart(64, "0");
const presets = {
  unlimited: { data: "0x095ea7b3" + spender + "f".repeat(64), value: "0x0" },
  collection: {
    data: "0xa22cb465" + spender + "1".padStart(64, "0"),
    value: "0x0",
  },
  transfer: { data: "0x", value: "10000000000000000" },
};
function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function severity(score) {
  return score >= 80 ? "high" : score >= 30 ? "medium" : "low";
}
function addHistory(kind, title, score) {
  history.unshift({ kind, title, score });
  history.splice(8);
  renderHistory();
}
function renderHistory() {
  $("history-list").replaceChildren();
  if (!history.length)
    $("history-list").append(
      element(
        "p",
        "Your checks will appear here during this session.",
        "history-empty",
      ),
    );
  for (const item of history) {
    const row = element("div", undefined, "history-row");
    row.append(
      element("span", item.kind, "history-kind"),
      element("span", item.title, "history-title"),
      element(
        "span",
        `${item.score}/100 · ${riskLabel(item.score)}`,
        `risk-pill ${severity(item.score)}`,
      ),
    );
    $("history-list").append(row);
  }
}
function errorResult(target, error) {
  target.className = "error-message";
  target.textContent =
    error.message === "Failed to fetch"
      ? "Backend unavailable. Start backend/run.sh and try again."
      : error.message;
}
async function runForm(form, target, request, render) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  target.className = "loading";
  target.textContent = "Reviewing…";
  try {
    render(await request());
  } catch (error) {
    errorResult(target, error);
  } finally {
    button.disabled = false;
  }
}
$("url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runForm(
    $("url-form"),
    $("url-result"),
    () => requestAPI("/api/analyze-url", { url: $("url-input").value }, ""),
    (data) => {
      const root = $("url-result");
      const level = severity(data.risk_score);
      root.className = `result ${level}`;
      const top = element("div", undefined, "result-top");
      top.append(
        element("div", data.hostname, "result-host"),
        element("span", riskLabel(data.risk_score), `risk-pill ${level}`),
      );
      const score = element(
        "div",
        String(data.risk_score),
        `risk-value ${level}`,
      );
      score.append(element("small", "/ 100"));
      root.replaceChildren(
        top,
        score,
        element("div", "HOSTNAME RISK INDICATORS", "score-caption"),
      );
      for (const reason of data.reasons) {
        const row = element("div", undefined, "finding");
        row.append(
          element("span", data.is_phishing ? "!" : "✓", "finding-mark"),
          element("p", reason),
        );
        root.append(row);
      }
      addHistory("Website check", data.hostname, data.risk_score);
    },
  );
});
for (const [id, url] of [
  ["trusted-example", "https://opensea.io"],
  ["suspicious-example", "https://opensea.io.example.com"],
]) {
  $(id).onclick = () => {
    $("url-input").value = url;
    $("url-form").requestSubmit();
  };
}
function preset(name) {
  $("recipient").value = contract;
  $("calldata").value = presets[name].data;
  $("value").value = presets[name].value;
  for (const button of document.querySelectorAll("[data-preset]")) {
    const active = button.dataset.preset === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}
for (const button of document.querySelectorAll("[data-preset]"))
  button.onclick = () => preset(button.dataset.preset);
preset("unlimited");
$("tx-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = {
    chain_id: Number($("chain").value),
    transaction: {
      to: $("recipient").value.trim(),
      data: $("calldata").value.trim(),
      value: $("value").value.trim(),
    },
  };
  runForm(
    $("tx-form"),
    $("tx-result"),
    () => requestAPI("/api/simulate", payload, ""),
    (data) => {
      const root = $("tx-result");
      root.className = `tx-report ${data.status}`;
      const heading = element("div", undefined, "report-heading");
      heading.append(
        element(
          "span",
          riskLabel(data.risk_score).toUpperCase(),
          "report-type",
        ),
        element("span", `${data.risk_score} / 100`, "report-score"),
      );
      root.replaceChildren(
        heading,
        element("h3", data.operation),
        element("p", data.summary),
      );
      if (data.approval) {
        const rows = [
          ["Spender", shortAddress(data.approval.spender)],
          [
            "Permission",
            data.approval.kind === "collection"
              ? "All NFTs in this collection"
              : BigInt(data.approval.amount) === 2n ** 256n - 1n
                ? "Unlimited allowance"
                : data.approval.amount,
          ],
        ];
        for (const [label, value] of rows) {
          const row = element("div", undefined, "permission-row");
          row.append(element("span", label), element("code", value));
          root.append(row);
        }
      }
      addHistory("Transaction review", data.operation, data.risk_score);
    },
  );
});
$("clear-history").onclick = () => {
  history.length = 0;
  renderHistory();
};
async function connection() {
  try {
    await requestAPI("/api/health", undefined, "");
    $("connection").textContent = "Local backend connected";
    $("connection").className = "connection online";
  } catch (_) {
    $("connection").textContent = "Backend offline";
    $("connection").className = "connection offline";
  }
}
connection();
setInterval(connection, 30000);
