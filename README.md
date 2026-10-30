# Housie Baaki

A local-first, mobile-friendly Housie companion: play with physical or digital tickets, share custom prizes, manage multiple rounds, and see who pays whom. Install it as a PWA and play offline after the first online load.

Production URL: [housiebaaki.app](https://housiebaaki.app/). Pushes to `main` run verification and publish through GitHub Actions.

Designed as a phone application: a sticky app bar, context-aware bottom navigation, a Tickets → Prizes → Review setup flow, separate prize/caller views, and bottom sheets for quick entry. Primary controls have at least 44 px touch targets; form inputs use 16 px text to avoid iPhone focus zoom. Layouts account for device safe areas and expand progressively on larger screens.

## Run locally

Requires Node.js **22.12+ or 24+** and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173/housie-baaki/`.

For the installable, offline-enabled production build:

```sh
npm run build
npm run preview
```

The service worker is enabled in the production build only. Use HTTPS when hosting; localhost also supports service workers and safe editing locks.

## Play

1. Start a gathering and add player names. One organizer keeps the ledger on the host’s device.
2. Create a round, set its ticket price, and enter each participant’s ticket quantity. Zero tickets means sitting out this round.
3. Set named prizes using either rupee amounts or percentages. Allocate the entire ticket pool. Use **Balance last prize** for the remainder, or add your own categories.
4. Save the draft or start the round. Ticket counts and prize values lock when play starts.
5. Optionally call unique numbers from 1–90. Manual marking and undo are available. The board and call history survive refreshes.
6. Check physical claims and record winners, or choose **Check digital ticket**, select the player, enter their four-digit ID, and tap **Show ticket**. Compare the preview with the player’s screen and check the claim yourself, then tap **Confirm & award**. For a physical-ticket tie, enter each winner’s winning-ticket count. The prize splits proportionally; a ticket can win more than one category.
7. Award every prize, then finish the round. Completed rounds contribute to dues. An unfinished round shows provisional amounts separately.
8. Play another round using the previous completed round’s settings, or check **Settle up**. Record full or partial payments only after money changes hands elsewhere.

Winner corrections recalculate dues and retain recorded payments. Mistaken payments can be reversed, with the original record retained. Cancelling an unfinished round excludes all its costs and wins. Closing a gathering preserves outstanding payments; reopen it to play again.

## Digital tickets: offline on every phone

1. Everyone loads the updated app online once before going offline, so its app shell, scanner fallback worker, and QR generator are cached.
2. The host starts a round and taps **Show round QR**. The app saves a random round key before displaying it. Reopening this QR uses the same key. **Share link** opens your phone’s share sheet; browsers without sharing support copy the link instead. The long link stays hidden unless manual copying is needed.
3. Players open **My tickets → Scan round QR**. Use the camera, choose a QR image, or paste the host’s round link. No registration or return QR is required.
4. Each browser profile receives one saved ticket per round, with a four-digit ID including leading zeros. Scan the same round again to restore it; there is no reroll button. The ticket opens in a full-screen paper-style view, best held sideways. Tap numbers to stamp or unstamp them. Marks survive refreshes and rotation. Use **Back to my tickets** to leave.
5. The host still records names and purchases before play. Joining does not update the host, and phones do not synchronize calls or marks. The host checks every claim manually and records one winning ticket after confirming the preview. This works for custom prizes and without the app’s number caller.

The host’s comparison preview circles ticket numbers present in the saved call history and shows how many of the 15 have been called. This is a visual aid; claim approval stays manual. With no saved calls, the ticket remains unmarked.

Ticket lookup does not change winnings. **Confirm & award** atomically records the winning ticket ID and a manual-confirmation activity. A repeated claim does not pay twice. Different players with the same ID have identical tickets and may share a prize; the UI explains the collision. An already-recorded award must be corrected before being replaced.

Four-digit IDs reconstruct a ticket using the selected round’s key. They do **not** prove which QR was scanned, ownership, purchase, or issuance time. Compare the actual numbers with the player’s screen. Codes can collide, and clearing storage or using another browser can bypass the one-ticket-per-profile limit. This is a trust-based game between people at the table.

There are no automatic winning-number rules or checks. The optional caller remains available, and call undo does not depend on awards. Historical evidence from the earlier automatic-verification version stays in old records and backups, labeled as historical; it no longer restricts game edits.

## Privacy and backups

- All game data stays in **IndexedDB in this browser profile**. No signup, server API, analytics, external fonts, or cloud sync.
- An exclusive Web Lock makes additional tabs of the same gathering read-only. Different gatherings can be edited independently.
- Export all gatherings, activity, and marked player tickets as a version 2 JSON backup from **Backup & restore**. Version 1 host-only backups are still accepted. Restore validates host records, legacy evidence structure, and saved ticket marks before atomic replacement and requires confirmation. As a full replacement, a version 1 restore clears any current player tickets. Close gathering tabs before restoring.
- Browser storage can be cleared by browser settings, private browsing, device resets, or browser eviction. Keep exported backups. Moving to another browser, domain, or device requires manual export/import.
- On iPhone, install from Safari’s **Share → Add to Home Screen**. Elsewhere use the browser’s install menu when available.
- No payment processing, cloud registration, device fingerprinting, or live synchronization is included. Camera images and round QR payloads are processed locally.

## Deploy on GitHub Pages

1. Create a GitHub repository and push these files to its `main` branch.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. The included workflow runs unit tests, builds the app, runs Chromium browser tests, and deploys `dist/` after all checks pass.
4. Open `https://<username>.github.io/<repository>/` online once, then install the app if desired.

The workflow builds and tests at `/` for the custom domain `housiebaaki.app`, including asset URLs, the PWA manifest, and the service worker. The local development default remains `/housie-baaki/`. To preview the custom-domain build locally, use `/` for both commands:

```sh
VITE_BASE_PATH=/ npm run build
VITE_BASE_PATH=/ npm run preview
```

For a fork hosted at `https://<username>.github.io/<repository>/` without a custom domain, change **both** `VITE_BASE_PATH` entries in `.github/workflows/deploy.yml` to `/<repository>/`. Hash navigation avoids server-side route rewrites. Keep the base path consistent between building, previewing, and browser tests.

**Update app** is always available in **Backup & restore** and **How it works**. It checks for a new version online and applies a downloaded update while keeping IndexedDB data. Offline checks explain that a connection is needed; an already downloaded update can still be applied offline. Updates wait while any saved round is in play; finish or cancel the round, then update. A ready-update banner also appears outside active rounds and the full-screen ticket view.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

On macOS, browser tests use installed Google Chrome. On Linux/CI they use Playwright Chromium. Test the production build: offline behavior is not enabled on the Vite dev server.

Unit tests cover paise parsing, deterministic rounding, ticket-weighted wins, budgets, settlement invariants, payments, corrections, caller exhaustion, backup integrity, and transaction rollback. Browser tests cover multi-round play, offline reloads, caller recovery, payment reversal, backup replacement, tab locks, responsive layouts, keyboard access, and WCAG AA checks with axe.

## Implementation

- React + TypeScript + Vite; custom responsive CSS and Lucide icons.
- `src/domain.ts`: validated domain types, pure money calculations, round rules, and caller selection. Money is integer paise; percentages are integer basis points. Largest-remainder allocation uses BigInt products and stable ID tie-breaking.
- `src/tickets.ts`: frozen deterministic ticket algorithm, and round-link parsing. `src/DigitalTickets.tsx` provides the host QR, player wallet, scanner, and manual ticket-preview flow.
- `src/db.ts`: Dexie storage. A gathering snapshot and its activity entry commit in one transaction. Backup replacement also uses a single transaction.
- `src/App.tsx`: player, round, caller, dues, activity, and backup screens.
- `src/useEditorLock.ts`: cross-tab editor and restore protection.
- `vite.config.ts`: base-path-aware manifest and Workbox precaching, including locally bundled fonts.
- `tests/`: production browser workflows and accessibility checks.

Regenerate PNG icons from the source SVG with `node scripts/generate-icons.mjs`. Fonts are DM Sans and Manrope, distributed through Fontsource under the SIL Open Font License; license files are included in the deployed assets.

### Ticket algorithm compatibility

Keep algorithm version 1 stable: its SHA-256 input is the UTF-8 string `housie-baaki/ticket/v1|<base64url-round-key>|<four-digit-ID>|<counter>`, with the counter starting at zero. Read each digest as eight big-endian unsigned 32-bit words. Bounded draws use rejection sampling, then Fisher–Yates shuffles. Select five columns per row, retrying the three-row occupancy until all nine columns are populated. Select each column’s numbers without replacement, sort them, and assign from top to bottom. Column ranges are 1–9, 10–19, …, 70–79, and 80–90.

For key `AAAAAAAAAAAAAAAAAAAAAA` and ID `0000`, the fixed vector is:

```text
 6  12   —   —   —  54  67  76   —
 7   —  24  33   —  58  68   —   —
 8  14   —  35  41   —   —   —  85
```

Future algorithm changes require a new version while preserving reconstruction of existing tickets. QR round data lives in the URL fragment and is parsed without navigating to or fetching the encoded URL.

`npm audit --omit=dev` checks shipped dependencies. The current tooling tree also includes a low-severity advisory in Workbox’s transitive `deepmerge` build dependency; no untrusted configuration is merged by this app.
