"""Local deterministic risk checks. No signing, RPC execution, or fake balances."""
import ipaddress
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app = FastAPI(title="Crypto-C Security", version="1.1.0")
ROOT = Path(__file__).resolve().parents[1]
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
BRANDS = {"opensea": "opensea.io", "metamask": "metamask.io",
          "uniswap": "uniswap.org", "etherscan": "etherscan.io"}


class UrlAnalysisRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


class TransactionSimulationRequest(BaseModel):
    transaction: dict
    chain_id: int = Field(default=1, gt=0)
    method: str = "eth_sendTransaction"


def analyze_url_value(value: str) -> dict:
    try:
        url = urlsplit(value.strip())
        host = (url.hostname or "").lower().rstrip(".")
        _ = url.port
        if url.scheme not in ("http", "https") or not host or any(c.isspace() for c in host):
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Enter a valid HTTP or HTTPS URL.")
    reasons = []
    score = 5
    for brand, trusted in BRANDS.items():
        if brand in host and host != trusted and not host.endswith("." + trusted):
            score = max(score, 90)
            reasons.append(f"The hostname mentions {brand}, but is not {trusted} or one of its subdomains.")
    if any(word in host for word in ("malicious", "drainer")):
        score = max(score, 95)
        reasons.append("The hostname contains a suspicious phishing or drainer keyword.")
    if url.username is not None or url.password is not None:
        score = max(score, 80)
        reasons.append("Embedded credentials can disguise the actual destination hostname.")
    if "xn--" in host:
        score = max(score, 55)
        reasons.append("An internationalized hostname may imitate a familiar domain.")
    try:
        ipaddress.ip_address(host)
        score = max(score, 35)
        reasons.append("The destination uses an IP address rather than a domain name.")
    except ValueError:
        pass
    if url.scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        score = max(score, 40)
        reasons.append("The connection does not use HTTPS.")
    reasons = reasons or ["No suspicious hostname indicators found. This does not establish that a site is safe."]
    return {"url": value.strip(), "hostname": host, "risk_score": score,
            "is_phishing": score >= 80, "details": reasons[0], "reasons": reasons,
            "analysis_type": "URL heuristics"}


def review_transaction(tx: dict, method: str, chain_id: int) -> dict:
    def report(status, score, summary, operation, **extra):
        return {"status": status, "risk_score": score, "summary": summary,
                "operation": operation, "chain_id": chain_id, "asset_changes": [],
                "analysis_type": "Calldata review", "approval": None, **extra}

    if method in ("eth_sign", "personal_sign") or method.startswith("eth_signTypedData"):
        return report("warning", 80, "A signature can authorize asset transfers. Read the full wallet signing request; this tool cannot verify its intent.", "Signature request")
    if method != "eth_sendTransaction":
        raise HTTPException(422, "Unsupported wallet method.")
    if not isinstance(tx.get("to"), str) or not ADDRESS.fullmatch(tx["to"]):
        raise HTTPException(422, "A valid 20-byte recipient address is required.")
    if tx.get("from") is not None and not ADDRESS.fullmatch(str(tx["from"])):
        raise HTTPException(422, "Invalid sender address.")
    data = tx.get("data", "0x")
    if not isinstance(data, str) or not re.fullmatch(r"0x(?:[0-9a-fA-F]{2})*", data):
        raise HTTPException(422, "Calldata must be an even-length hex string starting with 0x.")
    raw_value = tx.get("value", "0x0")
    try:
        if isinstance(raw_value, bool) or not isinstance(raw_value, (str, int)):
            raise ValueError()
        value = int(raw_value, 16 if isinstance(raw_value, str) and raw_value.startswith("0x") else 10) if isinstance(raw_value, str) else raw_value
        if value < 0 or value >= 2**256:
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid transaction value.")
    selector = data[:10].lower()
    if selector in ("0x095ea7b3", "0xa22cb465"):
        if len(data) != 138 or int(data[10:34], 16) != 0:
            raise HTTPException(422, "Approval calldata must contain a correctly encoded address and amount.")
        spender = "0x" + data[34:74].lower()
        amount = int(data[74:138], 16)
        kind = "token" if selector == "0x095ea7b3" else "collection"
        if kind == "collection" and amount not in (0, 1):
            raise HTTPException(422, "setApprovalForAll requires a boolean value.")
        approval = {"kind": kind, "contract": tx["to"].lower(), "spender": spender,
                    "owner": tx.get("from", "").lower(), "amount": str(amount),
                    "chain_id": chain_id, "is_revocation": amount == 0}
        if value:
            return report("critical", 95, "This approval also transfers native currency. Verify both the permission and the payment.", "Approval with payment", approval=approval)
        if amount == 0:
            if kind == "token":
                return report("warning", 45, "For ERC-20, this sets an allowance to zero. ERC-721 uses the same selector for token ID 0; verify the contract standard in your wallet.", "Zero allowance / token ID 0", approval=approval)
            return report("low", 5, "This call removes the selected spender's permission. Your wallet must submit it and the chain must confirm it.", "Revoke approval", approval=approval)
        if kind == "collection":
            return report("critical", 95, "This operator can transfer every NFT in this collection. Only proceed if you trust the contract and operator.", "Collection-wide approval", approval=approval)
        if amount == 2**256 - 1:
            return report("critical", 95, "For ERC-20, this spender receives an unlimited token allowance. A compromised spender could transfer your entire balance. Verify the token standard in your wallet.", "Unlimited token approval", approval=approval)
        return report("warning", 65, "This call sets a token allowance (or an ERC-721 token ID approval). Verify the contract, spender and amount in your wallet.", "Token approval", approval=approval)
    if data == "0x":
        return report("low" if value == 0 else "warning", 5 if value == 0 else 40,
                      "No contract calldata. Verify the recipient and native-currency amount; gas costs are not estimated.", "Native transfer", native_value_wei=str(value))
    return report("warning", 60, "Unrecognized contract call. Review it in your wallet; no contract state or asset balances have been simulated.", "Contract interaction")


@app.get("/api/health")
def health():
    return {"status": "active", "service": "Crypto-C Backend", "analysis_type": "Deterministic heuristics"}


@app.post("/api/analyze-url")
def analyze_url(request: UrlAnalysisRequest):
    return analyze_url_value(request.url)


@app.post("/api/simulate")
def simulate_transaction(request: TransactionSimulationRequest):
    # Kept for compatibility with the original extension; this is not EVM simulation.
    return review_transaction(request.transaction, request.method, request.chain_id)


@app.get("/")
def dashboard():
    return FileResponse(ROOT / "web" / "index.html")


app.mount("/app", StaticFiles(directory=ROOT / "web"), name="app")
app.mount("/extension", StaticFiles(directory=ROOT / "extension"), name="extension-assets")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
