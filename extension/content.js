const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);
script.onload = () => {
    script.remove();
};

window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type && event.data.type === 'CRYPTO_C_TX') {
        console.log("Content script received transaction:", event.data.payload);
        
        chrome.runtime.sendMessage({
            type: 'TRANSACTION_INTERCEPTED',
            payload: event.data.payload
        }, (response) => {
            window.postMessage({
                type: 'CRYPTO_C_TX_RESULT',
                payload: response
            }, '*');
        });
    }
});

