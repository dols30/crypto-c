(() => {
  const pending = new Map();
  const send = async (message) => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok)
      throw new Error(result?.error || "Crypto-C backend is unavailable.");
    return result.value;
  };

  function reviewDialog(report) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(8,20,41,.72);padding:24px";
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent =
        ":host{color:#14243c;font:15px/1.6 system-ui}section{background:white;max-width:460px;padding:28px;border-radius:16px;box-shadow:0 25px 80px #0006}h2{margin:0 0 12px;font-size:24px}p{margin:0 0 20px}button{font:inherit;font-weight:600;border:1px solid #cbd5e1;border-radius:8px;padding:10px 18px;background:white;cursor:pointer}button:last-child{background:#1749b3;color:white;margin-left:10px}button:focus-visible{outline:3px solid #86a8ff}small{display:block;color:#52627a;margin-bottom:18px}";
      const panel = document.createElement("section");
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Crypto-C transaction review");
      const heading = document.createElement("h2");
      heading.textContent =
        report.status === "unavailable"
          ? "Review unavailable"
          : `Crypto-C: ${report.operation || "Site warning"}`;
      const description = document.createElement("p");
      description.textContent = report.summary || report.details;
      const note = document.createElement("small");
      note.textContent =
        "Heuristic checks cannot guarantee safety. Your wallet is the final confirmation step.";
      const cancel = document.createElement("button");
      cancel.textContent = report.site ? "Dismiss warning" : "Cancel request";
      const proceed = document.createElement("button");
      proceed.textContent =
        report.status === "unavailable"
          ? "Continue without review"
          : "Continue to wallet";
      let finished = false;
      let timer;
      const finish = (decision) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        host.remove();
        resolve(decision);
      };
      cancel.onclick = () => finish(false);
      proceed.onclick = () => finish(true);
      panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Tab") {
          event.preventDefault();
          if (root.activeElement === cancel && !report.site) proceed.focus();
          else cancel.focus();
        }
      });
      panel.append(heading, description, note, cancel);
      if (!report.site) panel.append(proceed);
      root.append(style, panel);
      (document.body || document.documentElement).append(host);
      cancel.focus();
      timer = setTimeout(() => finish(false), 110000);
    });
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (
      event.source !== window ||
      !data ||
      data.source !== "crypto-c-provider" ||
      typeof data.id !== "string"
    )
      return;
    if (data.type === "REVIEW") {
      let report;
      try {
        report = await send({ type: "REVIEW_REQUEST", payload: data.payload });
      } catch (error) {
        report = {
          status: "unavailable",
          summary:
            error.message +
            " Start the local backend or explicitly continue without a review.",
        };
      }
      const proceed =
        report.status === "low" ? true : await reviewDialog(report);
      window.postMessage(
        {
          source: "crypto-c-content",
          type: "REVIEW_RESULT",
          id: data.id,
          proceed,
        },
        location.origin,
      );
    }
    if (data.type === "SUBMITTED") {
      send({
        type: "APPROVAL_SUBMITTED",
        payload: data.payload,
        hash: data.hash,
      }).catch(() => {});
    }
    if (data.type === "WALLET_RESULT" && pending.has(data.id)) {
      const { resolve, timer } = pending.get(data.id);
      clearTimeout(timer);
      pending.delete(data.id);
      resolve(data.result);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!["REVOKE_APPROVAL", "CHECK_APPROVALS"].includes(message.type)) return;
    const id = crypto.randomUUID();
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: "Wallet request timed out." });
      }, 120000);
      pending.set(id, { resolve, timer });
      window.postMessage(
        {
          source: "crypto-c-content",
          type: message.type,
          id,
          approval: message.approval,
          approvals: message.approvals,
        },
        location.origin,
      );
    }).then(respond);
    return true;
  });

  const scan = () =>
    send({ type: "ANALYZE_URL", url: location.href })
      .then((report) => {
        if (report.is_phishing) return reviewDialog({ ...report, site: true });
      })
      .catch(() => {});
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", scan, { once: true });
  else scan();
})();
