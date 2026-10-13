# Crypto-C extension design

The primary product is the installed Manifest V3 extension. Its toolbar button opens a floating panel over the active webpage. The local web workspace remains an optional diagnostic tool in Settings.

## References reviewed

- [Pocket Universe](https://www.pocketuniverse.app/): official transaction popup screenshots separate context, the consequence of signing, and the final decision. Adopt plain language risk explanations and strong warning hierarchy.
- [Rabby Wallet](https://chromewebstore.google.com/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch): official extension listing and [source architecture](https://github.com/RabbyHub/Rabby) emphasize pre-transaction reviews and distinct popup/request surfaces. Keep website scanning separate from observed wallet permissions and review history.
- [Scam Sniffer](https://www.scamsniffer.io/): explicit site-check outcomes and visible detection scope. Make Crypto-C's heuristic limits and local connection status easy to inspect.

These are design references, not integrations. Crypto-C does not inherit their threat intelligence, reputation databases, coverage, balance estimates, or simulation capabilities.

## Direction

Design read: a compact security extension for Web3 users, with Apple-inspired graphite surfaces and the existing Crypto-C wordmark and blue identity preserved. `DESIGN_VARIANCE=4`, `MOTION_INTENSITY=2`, `VISUAL_DENSITY=5`.

- A floating panel up to 480 × 740, with a 20px rounded outer silhouette, constrained to the viewport. Width, relative spacing and typography scale together; narrow or short screens use internal scrolling. A closed shadow root isolates the host styles; an extension-origin iframe contains the interface. Tabs and scrollable panels keep controls accessible on shorter viewports.
- A current-site context row and prominent risk summary. Neutral text for low indicators; amber and red are reserved for warnings.
- Overview, Permissions and Activity tabs, with keyboard navigation and real stored counts.
- One graphite appearance, per the user's revised request. No theme picker or colored status dots.
- Native platform UI typography and vendored Phosphor icons. No CDN requests from the popup.
- Empty, loading, unavailable, pending, confirmed and revoked states remain distinct. No invented permissions, balances or safety guarantees.
- Motion supports state feedback only and respects reduced-motion preferences.

The icon license is shipped in `extension/assets`. Update the asset files from the pinned development dependencies when changing these resources; no bundler is required to install the extension.

Apple references: [materials](https://developer.apple.com/design/human-interface-guidelines/materials), [typography](https://developer.apple.com/design/human-interface-guidelines/typography), and [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons). This is an original web approximation of native panel styling, not Apple Liquid Glass or an official Apple component library.
