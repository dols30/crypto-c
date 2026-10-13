(() => {
  let forwarded = 0;
  // A deliberately named test adapter for browser integration tests, never used by the workspace or extension.
  window.chrome = {
    runtime: {
      async sendMessage(message) {
        if (message.type === "APPROVAL_SUBMITTED")
          return { ok: true, value: { saved: false } };
        const path =
          message.type === "ANALYZE_URL" ? "/api/analyze-url" : "/api/simulate";
        const payload =
          message.type === "ANALYZE_URL"
            ? { url: message.url }
            : {
                transaction:
                  message.payload.method === "eth_sendTransaction"
                    ? message.payload.params[0]
                    : {},
                method: message.payload.method,
                chain_id: message.payload.chain_id,
              };
        try {
          const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const value = await response.json();
          return response.ok
            ? { ok: true, value }
            : { ok: false, error: value.detail };
        } catch (_) {
          return { ok: false, error: "Backend unavailable" };
        }
      },
      onMessage: { addListener() {} },
    },
  };
  window.ethereum = {
    async request(args) {
      if (args.method === "eth_chainId") return "0x1";
      if (args.method === "eth_accounts") return ["0x" + "3".repeat(40)];
      forwarded++;
      document.getElementById("wallet-count").textContent =
        `Requests forwarded to test wallet: ${forwarded}`;
      return args.method === "eth_sendTransaction"
        ? "0x" + "a".repeat(64)
        : "TEST_SIGNATURE_ONLY";
    },
  };
  async function request(args) {
    try {
      const result = await window.ethereum.request(args);
      document.getElementById("sandbox-result").textContent =
        `Test wallet result: ${result}`;
    } catch (error) {
      document.getElementById("sandbox-result").textContent =
        `Rejected (${error.code}): ${error.message}`;
    }
  }
  document.getElementById("nft-request").onclick = () =>
    request({
      method: "eth_sendTransaction",
      params: [
        {
          from: "0x" + "3".repeat(40),
          to: "0x" + "1".repeat(40),
          data:
            "0xa22cb465" +
            "2".repeat(40).padStart(64, "0") +
            "1".padStart(64, "0"),
        },
      ],
    });
  document.getElementById("sign-request").onclick = () =>
    request({
      method: "personal_sign",
      params: ["0xab", "0x" + "3".repeat(40)],
    });
})();
