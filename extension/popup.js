document.addEventListener('DOMContentLoaded', async () => {
    const siteUrlEl = document.getElementById('site-url');
    const riskScoreEl = document.getElementById('risk-score');
    const progressBarFill = document.querySelector('.progress-bar .fill');
    const statusBadge = document.querySelector('.status-badge');
    const approvalsList = document.getElementById('approvals-list');
    const revokeAllBtn = document.getElementById('revoke-all-btn');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
            const url = new URL(tab.url);
            siteUrlEl.textContent = url.hostname;
            checkPhishingStatus(tab.url);
        } else {
            siteUrlEl.textContent = "Unknown";
        }
    } catch (e) {
        siteUrlEl.textContent = "Error getting tab";
    }

    loadMockApprovals();
    document.getElementById('refresh-approvals').addEventListener('click', loadMockApprovals);
    
    async function checkPhishingStatus(url) {
        try {
            const response = await fetch('http://localhost:8000/api/analyze-url', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            });
            
            if (response.ok) {
                const data = await response.json();
                updateRiskUI(data.risk_score);
            } else {
                throw new Error('Backend not available');
            }
        } catch (error) {
            console.log('Backend not available, using mock mode:', error);
            const isPhishing = url.includes('malicious') || url.includes('drainer');
            const score = isPhishing ? 95 : 5;
            updateRiskUI(score);
        }
    }

    function updateRiskUI(score) {
        riskScoreEl.textContent = `${score}/100`;
        progressBarFill.style.width = `${score}%`;
        
        progressBarFill.className = 'fill';
        riskScoreEl.className = 'score';
        statusBadge.className = 'status-badge';

        if (score < 30) {
            progressBarFill.classList.add('low');
            riskScoreEl.classList.add('low');
            statusBadge.classList.add('safe');
            statusBadge.textContent = "Protected";
        } else if (score < 70) {
            progressBarFill.classList.add('medium');
            riskScoreEl.classList.add('medium');
            statusBadge.classList.add('warning');
            statusBadge.textContent = "Caution";
        } else {
            progressBarFill.classList.add('high');
            riskScoreEl.classList.add('high');
            statusBadge.classList.add('danger');
            statusBadge.textContent = "High Risk";
        }
    }

    function loadMockApprovals() {
        approvalsList.innerHTML = '';
        
        const mockApprovals = [
            { token: 'USDC', spender: '0x1234...abcd', risk: 'high' },
            { token: 'BoredApe', spender: '0xMalicious...Contract', risk: 'critical' }
        ];

        if (mockApprovals.length === 0) {
            approvalsList.innerHTML = '<div class="empty-state">No active approvals found.</div>';
            revokeAllBtn.disabled = true;
            return;
        }

        mockApprovals.forEach(app => {
            const item = document.createElement('div');
            item.className = 'approval-item';
            item.innerHTML = `
                <div class="token-info">
                    <div class="token-name">${app.token}</div>
                    <div class="spender">Spender: ${app.spender}</div>
                </div>
                <button class="revoke-btn">Revoke</button>
            `;
            approvalsList.appendChild(item);
        });
        
        revokeAllBtn.disabled = false;
    }
});

