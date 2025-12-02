console.log("Crypto-C: Injection successful");

const originalRequest = window.ethereum ? window.ethereum.request : null;

if (window.ethereum && originalRequest) {
    window.ethereum.request = async function (args) {
        if (args.method === 'eth_sendTransaction' || args.method.startsWith('eth_sign')) {
            console.log("Crypto-C: Intercepted request", args);
            
            window.postMessage({
                type: 'CRYPTO_C_TX',
                payload: args
            }, '*');

            return new Promise((resolve, reject) => {
                const handler = (event) => {
                    if (event.source !== window) return;
                    if (event.data.type === 'CRYPTO_C_TX_RESULT') {
                        window.removeEventListener('message', handler);
                        
                        const riskReport = event.data.payload;
                        console.log("Crypto-C: Analysis Result", riskReport);

                        if (riskReport.status === 'risk') {
                            const proceed = confirm(`⚠️ Crypto-C Security Alert ⚠️\n\n${riskReport.summary}\n\nDo you want to proceed?`);
                            if (proceed) {
                                resolve(originalRequest.call(window.ethereum, args));
                            } else {
                                reject({ code: 4001, message: 'Transaction rejected by user (Crypto-C)' });
                            }
                        } else {
                            resolve(originalRequest.call(window.ethereum, args));
                        }
                    }
                };
                window.addEventListener('message', handler);
            });
        }
        
        return originalRequest.call(window.ethereum, args);
    };
}

