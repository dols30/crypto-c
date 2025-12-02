chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) {
        analyzeUrl(details.url, details.tabId);
    }
});

async function analyzeUrl(url, tabId) {
    try {
        console.log(`Analyzing URL: ${url}`);
        
        try {
            const response = await fetch('http://localhost:8000/api/analyze-url', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.is_phishing || result.risk_score > 85) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: showWarningOverlay
                    });
                }
                return;
            }
        } catch (fetchError) {
            console.log('Backend not available, using mock mode');
        }
        
        const isPhishing = url.includes('malicious');
        
        if (isPhishing) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: showWarningOverlay
            });
        }
    } catch (err) {
        console.error("Analysis failed:", err);
    }
}

function showWarningOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 0, 0, 0.9);
        color: white;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-family: sans-serif;
    `;
    overlay.innerHTML = `
        <h1>⚠️ Phishing Warning ⚠️</h1>
        <p>This site has been identified as a potential phishing attack by Crypto-C.</p>
        <button id="crypto-c-dismiss" style="margin-top: 20px; padding: 10px 20px; font-size: 16px;">I understand the risk</button>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('crypto-c-dismiss').onclick = () => {
        overlay.remove();
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSACTION_INTERCEPTED') {
        handleTransaction(message.payload).then(sendResponse);
        return true;
    }
});

async function handleTransaction(payload) {
    console.log("Transaction intercepted:", payload);
    
    try {
        const response = await fetch('http://localhost:8000/api/simulate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                transaction: payload.params || payload,
                chain_id: 1
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            return {
                status: result.status,
                riskScore: result.risk_score,
                summary: result.summary
            };
        }
    } catch (fetchError) {
        console.log('Backend not available, using mock mode');
    }
    
    return {
        status: "risk",
        riskScore: 85,
        summary: "You are approving a transfer of ALL your USDT to an unknown address."
    };
}

