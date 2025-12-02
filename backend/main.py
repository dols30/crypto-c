from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, Dict, Any

app = FastAPI(title="Crypto-C Security Backend")

class UrlAnalysisRequest(BaseModel):
    url: str

class UrlAnalysisResponse(BaseModel):
    url: str
    risk_score: float
    is_phishing: bool
    details: str

class TransactionSimulationRequest(BaseModel):
    transaction: Dict[str, Any]
    chain_id: Optional[int] = 1

class TransactionSimulationResponse(BaseModel):
    status: str
    risk_score: float
    summary: str
    asset_changes: list

@app.get("/")
def read_root():
    return {"status": "active", "service": "Crypto-C Backend"}

@app.post("/api/analyze-url", response_model=UrlAnalysisResponse)
def analyze_url(request: UrlAnalysisRequest):
    url = request.url.lower()
    risk_score = 0.0
    is_phishing = False
    details = "Safe website."

    if "malicious" in url or "drainer" in url:
        risk_score = 95.0
        is_phishing = True
        details = "Detected known malicious pattern in URL."
    elif "opensea" in url and "opensea.io" not in url:
        risk_score = 85.0
        is_phishing = True
        details = "Potential typo-squatting detected (Fake OpenSea)."

    return {
        "url": request.url,
        "risk_score": risk_score,
        "is_phishing": is_phishing,
        "details": details
    }

@app.post("/api/simulate", response_model=TransactionSimulationResponse)
def simulate_transaction(request: TransactionSimulationRequest):
    tx = request.transaction
    
    if "data" in tx and tx["data"] != "0x":
        if "0xa22cb465" in tx["data"]:
            return {
                "status": "critical",
                "risk_score": 100.0,
                "summary": "You are granting FULL ACCESS to your NFT collection (setApprovalForAll).",
                "asset_changes": ["Approved: All NFTs"]
            }
        
        if "0x095ea7b3" in tx["data"]:
            return {
                "status": "warning",
                "risk_score": 70.0,
                "summary": "You are approving a token transfer. Verify the spender address.",
                "asset_changes": ["Approved: Token"]
            }

    return {
        "status": "safe",
        "risk_score": 10.0,
        "summary": "Standard transaction detected.",
        "asset_changes": ["-0.01 ETH (Gas)"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

