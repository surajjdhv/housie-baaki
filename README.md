# Housie Baaki

A local-first, mobile-friendly Housie companion: log physical tickets, share custom prizes, play multiple rounds, and see who pays whom. Install it as a PWA and play offline after the first online load.

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

1. Start a gathering and add player names. One organizer uses one device.
2. Create a round, set its ticket price, and enter each participant’s ticket quantity. Zero tickets means sitting out this round.
3. Set named prizes using either rupee amounts or percentages. Allocate the entire ticket pool. Use **Balance last prize** for the remainder, or add your own categories.
4. Save the draft or start the round. Ticket counts and prize values lock when play starts.
5. Optionally call unique numbers from 1–90. Manual marking and undo are available. The board and call history survive refreshes.
6. Check physical claims and record winners. For a tie, enter each winner’s winning-ticket count. The prize splits proportionally; a ticket can win more than one category.
7. Award every prize, then finish the round. Completed rounds contribute to dues. An unfinished round shows provisional amounts separately.
8. Play another round using the previous completed round’s settings, or check **Settle up**. Record full or partial payments only after money changes hands elsewhere.

Winner corrections recalculate dues and retain recorded payments. Mistaken payments can be reversed, with the original record retained. Cancelling an unfinished round excludes all its costs and wins. Closing a gathering preserves outstanding payments; reopen it to play again.

## Privacy and backups

- All game data stays in **IndexedDB in this browser profile**. No signup, server API, analytics, external fonts, or cloud sync.
- An exclusive Web Lock makes additional tabs of the same gathering read-only. Different gatherings can be edited independently.
- Export all gatherings and activity as a versioned JSON backup from **Backup & restore**. Restore validates the entire file before replacement and requires confirmation. Close gathering tabs before restoring.
- Browser storage can be cleared by browser settings, private browsing, device resets, or browser eviction. Keep exported backups. Moving to another browser, domain, or device requires manual export/import.
- On iPhone, install from Safari’s **Share → Add to Home Screen**. Elsewhere use the browser’s install menu when available.
- No payment processing, digital ticket generation, or automatic claim checking is included.

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

An update prompt appears when a new service worker is ready. It is deferred while any saved round is in play. Applying the update retains IndexedDB data.

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
- `src/db.ts`: Dexie storage. A gathering snapshot and its activity entry commit in one transaction. Backup replacement also uses a single transaction.
- `src/App.tsx`: player, round, caller, dues, activity, and backup screens.
- `src/useEditorLock.ts`: cross-tab editor and restore protection.
- `vite.config.ts`: base-path-aware manifest and Workbox precaching, including locally bundled fonts.
- `tests/`: production browser workflows and accessibility checks.

Regenerate PNG icons from the source SVG with `node scripts/generate-icons.mjs`. Fonts are DM Sans and Manrope, distributed through Fontsource under the SIL Open Font License; license files are included in the deployed assets.

`npm audit --omit=dev` checks shipped dependencies. The current tooling tree also includes a low-severity advisory in Workbox’s transitive `deepmerge` build dependency; no untrusted configuration is merged by this app.
