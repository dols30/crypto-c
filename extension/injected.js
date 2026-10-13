(() => {
  const providers = new Map();
  const pending = new Map();
  const address = /^0x[\da-f]{40}$/i;
  const protectedMethod = (method) =>
    method === "eth_sendTransaction" ||
    method === "personal_sign" ||
    method === "eth_sign" ||
    method.startsWith("eth_signTypedData");
  const post = (message) =>
    window.postMessage(
      { source: "crypto-c-provider", ...message },
      location.origin,
    );
  const rpcError = (message, code = 4001) =>
    Object.assign(new Error(message), { code });

  function install(provider) {
    if (
      !provider ||
      providers.has(provider) ||
      typeof provider.request !== "function"
    )
      return;
    const original = provider.request.bind(provider);
    try {
      const wrapped = async (args) => {
        if (
          !args ||
          typeof args.method !== "string" ||
          !protectedMethod(args.method)
        )
          return original(args);
        // Snapshot the request so page code cannot mutate it while the review is open.
        const request = structuredClone(args);
        const chain_id = Number(await original({ method: "eth_chainId" }));
        const payload = { ...request, params: request.params || [], chain_id };
        const id = crypto.randomUUID();
        const proceed = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve(false);
          }, 120000);
          pending.set(id, { resolve, timer });
          post({ type: "REVIEW", id, payload });
        });
        if (!proceed) throw rpcError("Request cancelled by Crypto-C.");
        const result = await original(request);
        if (request.method === "eth_sendTransaction")
          post({ type: "SUBMITTED", id, payload, hash: result });
        return result;
      };
      provider.request = wrapped;
      if (provider.request !== wrapped) return;
      providers.set(provider, original);
    } catch (_) {
      /* Some wallets expose immutable providers; their own review remains authoritative. */
    }
  }

  function validateApproval(row) {
    if (
      !row ||
      ![row.owner, row.contract, row.spender].every((value) =>
        address.test(value || ""),
      ) ||
      !["token", "collection"].includes(row.kind) ||
      !Number.isSafeInteger(row.chain_id) ||
      row.chain_id < 1
    ) {
      throw new Error("Invalid approval record.");
    }
  }

  async function walletFor(row) {
    validateApproval(row);
    for (const request of providers.values()) {
      try {
        const chain = Number(await request({ method: "eth_chainId" }));
        const accounts = await request({ method: "eth_accounts" });
        if (
          chain === row.chain_id &&
          accounts.some(
            (item) => item.toLowerCase() === row.owner.toLowerCase(),
          )
        )
          return request;
      } catch (_) {
        /* Try the next announced provider. */
      }
    }
    throw new Error(
      "Connect the original wallet account on the approval chain, then refresh.",
    );
  }

  async function permission(request, row) {
    const owner = row.owner.slice(2).toLowerCase().padStart(64, "0");
    const spender = row.spender.slice(2).toLowerCase().padStart(64, "0");
    if (row.kind === "token") {
      // approve(address,uint256) is shared by ERC-20 and ERC-721. Never send an ERC-20
      // revocation to an NFT contract. First check ERC-165, then require a valid allowance read.
      const nftData = "0x01ffc9a7" + "80ac58cd".padEnd(64, "0");
      try {
        const nft = await request({
          method: "eth_call",
          params: [{ to: row.contract, data: nftData }, "latest"],
        });
        if (/^0x[\da-f]{64}$/i.test(nft) && BigInt(nft) !== 0n)
          throw new Error(
            "ERC-721 token approvals must be managed in your wallet.",
          );
      } catch (error) {
        if (error.message?.includes("ERC-721")) throw error;
      }
    }
    const selector = row.kind === "token" ? "0xdd62ed3e" : "0xe985e9c5";
    const result = await request({
      method: "eth_call",
      params: [
        { to: row.contract, data: selector + owner + spender },
        "latest",
      ],
    });
    if (!/^0x[\da-f]{64}$/i.test(result))
      throw new Error(
        "The contract does not expose the expected approval read.",
      );
    return BigInt(result) > 0n;
  }

  async function revoke(row) {
    const request = await walletFor(row);
    if (!(await permission(request, row)))
      throw new Error("No active allowance found. Refresh the approval list.");
    // Read-only checks finish before the wallet is asked to confirm a transaction.
    const selector = row.kind === "token" ? "0x095ea7b3" : "0xa22cb465";
    const data =
      selector +
      row.spender.slice(2).toLowerCase().padStart(64, "0") +
      "0".repeat(64);
    const chain = Number(await request({ method: "eth_chainId" }));
    const accounts = await request({ method: "eth_accounts" });
    if (
      chain !== row.chain_id ||
      !accounts.some(
        (account) => account.toLowerCase() === row.owner.toLowerCase(),
      )
    ) {
      throw new Error(
        "The wallet account or chain changed during the permission check. Refresh and try again.",
      );
    }
    const hash = await request({
      method: "eth_sendTransaction",
      params: [
        {
          from: row.owner,
          to: row.contract,
          data,
          value: "0x0",
          chainId: "0x" + row.chain_id.toString(16),
        },
      ],
    });
    return { hash };
  }

  async function check(rows) {
    const updates = [];
    for (const row of (Array.isArray(rows) ? rows : []).slice(0, 50)) {
      try {
        const request = await walletFor(row);
        const receipt = await request({
          method: "eth_getTransactionReceipt",
          params: [row.hash],
        });
        let state = row.state;
        if (receipt?.status === "0x0") state = "failed";
        else if (receipt?.status === "0x1")
          state = (await permission(request, row)) ? "confirmed" : "revoked";
        updates.push({
          key: [row.chain_id, row.owner, row.contract, row.spender]
            .join(":")
            .toLowerCase(),
          hash: row.hash,
          state,
        });
      } catch (_) {
        /* Preserve previous state if the matching wallet or contract is unavailable. */
      }
    }
    return updates;
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== "crypto-c-content")
      return;
    if (data.type === "REVIEW_RESULT" && pending.has(data.id)) {
      const { resolve, timer } = pending.get(data.id);
      clearTimeout(timer);
      pending.delete(data.id);
      resolve(data.proceed === true);
    }
    if (["REVOKE_APPROVAL", "CHECK_APPROVALS"].includes(data.type)) {
      try {
        const result =
          data.type === "REVOKE_APPROVAL"
            ? await revoke(data.approval)
            : await check(data.approvals);
        post({ type: "WALLET_RESULT", id: data.id, result });
      } catch (error) {
        post({
          type: "WALLET_RESULT",
          id: data.id,
          result: { error: error.message },
        });
      }
    }
  });

  install(window.ethereum);
  window.addEventListener("ethereum#initialized", () =>
    install(window.ethereum),
  );
  window.addEventListener("eip6963:announceProvider", (event) =>
    install(event.detail?.provider),
  );
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  let attempts = 0;
  const timer = setInterval(() => {
    install(window.ethereum);
    if (++attempts >= 60) clearInterval(timer);
  }, 500);
})();
