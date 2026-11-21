# PLAN — InventoryCrawler

Status legend: `[ ]` open · `[x]` done · `[~]` in progress · `(?)` needs decision/info from user

## Phase 0 — Setup ✅
- [x] Install tooling (git, gh, Node.js LTS)
- [x] Analyze Android save files, crack checksum (SHA-1 of `Data`, CRLF, 2-space indent)
- [x] `CLAUDE.md`, `docs/SAVE_FORMAT.md`, `.gitignore` (real saves excluded)
- [x] Public repo `Slydee23/inventory-crawler`, GitHub Pages from `main` root

## Phase 1 — Save core (no UI) ✅
- [x] `.gitattributes`: force LF, treat fixtures as binary (global `core.autocrlf` would corrupt them)
- [x] `js/json-lossless.js`: parser + serializer keeping key order and number literals
- [x] `js/checksum.js`: SHA-1 via `crypto.subtle` (works in browser + Node)
- [x] `js/save-file.js`: load envelope, verify checksum, serialize, recompute checksum
- [x] Synthetic test fixture (checksum computed by an independent method) + golden round-trip tests against local real saves in `VC Save/` / `samples/` when present — both Android saves round-trip byte-identical
- [x] Helpers for .NET formats: floats with `.0`, TimeSpan `PlayTime`, `[{Key,Value}]` dictionaries

## Phase 2 — Research game data (needs more saves)
- [x] Diff saves after more play (`VC Save/nach-1h/`) → documented in `docs/SAVE_FORMAT.md`
- [ ] (?) Mid-run save → document `GameSaveData.SaveObjects`
- [x] `data/ids.json` + `tools/extract-ids.mjs`: characters (25), cards (75), gems (62), power-ups (20) complete
- [ ] Still incomplete: relics, arcanas, dungeons, achievements — need later-game saves or community sources
- [x] Game accepts an edited save: +10k coins (both TotalCoins fields) loaded on Android and spendable in-game (2026-11-21)
- [x] Character roster cross-checked with vampire.survivors.wiki: all 25 IDs are playable (3 from Death Parade update); display names, unlock hints, prices added
- [x] Characters grouped by content release (Base game 22, Death Parade update 3); unknown IDs fall into "New / not yet categorized"
- [ ] Verify the 22 base-game unlock hints against the wiki (currently from guides)
- Reference: https://vampire.survivors.wiki/w/Crawlers:Characters is the most reliable source (guides were incomplete/wrong)
- [ ] In-game test: unlocking a character via CharactersPurchased (user test on Android) — e.g. coins changed in both `ProfileSaveData.TotalCoins` and `ProgressionSaveData.TotalCoins`
- [ ] (?) Collect a PC/Steam save to confirm cross-platform parity

## Phase 3 — Editor UI (MVP)
- [x] One tab per category: Overview · Characters · Relics · Power-ups · Cards · Achievements · Other · Raw JSON (Experimental sections live in their category tab)
- [x] App shell: open file (picker + drag & drop), detect file type (profile / settings)
- [x] Overview: profile info, playtime, checksum status
- [x] Coins editor (keeps both TotalCoins fields in sync)
- [x] Unlock editors: all characters, discovered cards, relics (search + All/None), power-up levels
- [ ] Gem editors (frequencies, rarities, card gem slots) — after meaning is confirmed
- [x] Power-up max levels from shop screenshot
- [x] `PowerUp_Charm` = dev leftover without effect → hidden (`hidden` in `data/ids.json`). Collapsed "Experimental" section stays available via `experimental` map for future unconfirmed IDs
- [x] Settings editor (generic fields, volume sliders)
- [x] Raw JSON view for everything else (lossless)
- [x] Export: download edited file + original backup, validate before download
- [x] Dark, game-flavored styling (no game assets; Silkscreen OFL pixel font); mobile friendly

## Phase 3b — Category deep-dives (like Characters: full ID list, wiki names, hints, update groups)
- [x] Characters
- [x] Power-ups: wiki names/effects/base prices, grouped by shop tier, Max/Reset per group
- [ ] Greed max level: wiki 4 vs. screenshot 3 — confirm in-game
- [ ] Relics
- [ ] Cards
- [ ] Achievements

## Phase 4 — Polish & release
- [ ] How-to page: where save files are on Android / PC / Switch, how to copy them back
- [ ] Error handling for unknown versions (`saveSystemVersion` ≠ 0.30.0 → warning)
- [ ] README with screenshots, disclaimer
- [ ] Release v1.0

## Open decisions
- (?) Feature scope for MVP — which edits matter most to the user?
- [x] Visual style: dark gothic panels, gold frames, blood-red accents (user: "im Design des Games")
