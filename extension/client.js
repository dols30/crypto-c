export const DEFAULT_BACKEND = "http://127.0.0.1:8000";
export const ADDRESS = /^0x[\da-f]{40}$/i;
export const HASH = /^0x[\da-f]{64}$/i;

export async function requestAPI(path, payload, base = DEFAULT_BACKEND) {
  const response = await fetch(`${base}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Check the input and try again.",
    );
  }
  return data;
}

export function normalizeRequest(payload) {
  if (
    !payload ||
    typeof payload.method !== "string" ||
    !Array.isArray(payload.params)
  ) {
    throw new Error("Invalid wallet request.");
  }
  const chain_id = Number(payload.chain_id);
  if (!Number.isSafeInteger(chain_id) || chain_id <= 0)
    throw new Error("Invalid chain ID.");
  const transaction =
    payload.method === "eth_sendTransaction" ? payload.params[0] : {};
  if (
    !transaction ||
    typeof transaction !== "object" ||
    Array.isArray(transaction)
  ) {
    throw new Error("Missing transaction object.");
  }
  return { transaction, method: payload.method, chain_id };
}

export function approvalKey(row) {
  return [row.chain_id, row.owner, row.contract, row.spender]
    .map(String)
    .join(":")
    .toLowerCase();
}

export function riskLabel(score) {
  if (score == null) return "Unavailable";
  return score >= 80
    ? "High risk"
    : score >= 30
      ? "Review needed"
      : "Low indicators";
}

export function shortAddress(address) {
  return address
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : "Not provided";
}
