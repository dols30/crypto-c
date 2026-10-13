# Crypto-C Web3 Security

A local browser extension and security workspace for inspecting Web3 URLs and wallet requests. The app performs deterministic hostname and calldata checks. It does not use a trained ML model, run an EVM simulation, or guarantee that a site or transaction is safe.

## Run locally

Requires Python 3.10+ and Chrome/Brave 111+ for the extension. Node 20+ is needed only for the JavaScript tests.

```bash
git clone https://github.com/dols30/crypto-c.git
cd crypto-c
bash backend/run.sh
```

The first run creates `backend/.venv` and installs the Python dependencies. Open **http://127.0.0.1:8000** for the security workspace. Keep the backend running. API reference: **http://127.0.0.1:8000/docs**.

The workspace checks URLs and reviews manually entered transaction calldata without connecting to a wallet, signing anything or transmitting a blockchain transaction. The preset buttons are clearly labeled examples. Results come from the same backend used by the extension.

## Install the unpacked extension

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select this repository's `extension` directory.
4. Reload any existing dApp tabs so the content scripts run.
5. Open the extension popup to check the current page or inspect observed approvals.

The extension checks HTTP/HTTPS pages when they load. On supported, writable EIP-1193 providers, it reviews `eth_sendTransaction`, `eth_sign`, `personal_sign`, and typed-data signing requests before forwarding them to the wallet. It discovers late providers through EIP-6963, the initialization event and a bounded startup poll. Risky, unknown and unavailable analyses require an explicit decision; cancelled or timed-out requests are rejected with code 4001. The wallet still makes the final authorization decision.

## Approval management

The extension records approval transactions it **observes being submitted**. It does not import existing wallet history or invent token names or balances. A submitted transaction is not treated as a confirmed permission.

- **Refresh** on the original connected dApp checks receipts and current allowances using the matching wallet account and chain.
- **Revoke in wallet** is available for confirmed permissions. It reads the permission first, then prepares an ERC-20 zero allowance or a collection-wide `setApprovalForAll(false)` request.
- Revocation requires wallet confirmation and network gas. The UI keeps it as **revocation submitted** until a mined receipt and a zero permission read establish that it is revoked.
- Individual ERC-721 approvals share the `approve(address,uint256)` selector with ERC-20. The tool warns about this ambiguity and refuses ERC-20-style revocation when ERC-165 identifies an NFT contract. Manage individual NFT permissions in your wallet.

## Checks and limits

URL checks inspect the parsed hostname, including brand lookalikes, embedded credentials, suspicious keywords, punycode and unencrypted connections. A familiar brand name in an attacker's hostname or URL path does not establish trust. There is no external threat-intelligence feed.

Transaction checks decode supported approval selectors and flag unlimited allowances, collection-wide access, signatures, native payments and unrecognized calls. They do not predict asset changes, gas, contract behavior or signing intent. No private keys or seed phrases are requested.

The page-provider bridge is a **best-effort convenience, not a security boundary** against a hostile dApp. Page scripts share the main execution world and can replace providers or forge page messages. Immutable providers, unsupported RPC methods, cross-origin frames and wallets that do not expose a writable provider may bypass review. Continue to inspect the wallet's own request.

Browser analysis works only while the loopback backend is running on port 8000. An outage is shown explicitly; no mock score or mock approval fallback is used. Site warnings can be dismissed. Checks do not block navigation or inspect page content.

## Verify

```bash
backend/.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.test.js
```

Backend tests cover hostname bypasses, malformed input, approval decoding and explicit unknown-call results. Provider tests cover cancellation, concurrent requests, request snapshots, timeouts, late discovery, wrong-chain revocation, ERC-721 ambiguity and confirmation checks. For a no-funds browser test, open **http://127.0.0.1:8000/app/sandbox.html**. Its test wallet never sends a real transaction.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Backend connectivity |
| `POST /api/analyze-url` | Hostname heuristics for `{ "url": "https://example.com" }` |
| `POST /api/simulate` | Compatibility endpoint for static transaction review; accepts `transaction`, `method`, `chain_id` |

The server binds to `127.0.0.1` and does not enable cross-origin API access. Inputs are not logged or sent to external services. The extension stores up to 50 observed permissions and 20 review summaries in local browser storage. The web workspace keeps review history only in memory.
