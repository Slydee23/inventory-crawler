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
- [ ] (?) Diff saves after 1h play (`VC Save/nach-1h/`) → document new fields in `docs/SAVE_FORMAT.md`
- [ ] (?) Mid-run save → document `GameSaveData.SaveObjects`
- [ ] Build `data/*.json` ID lists (characters, cards, relics, arcanas, power-ups, gems, dungeons, achievements) — from saves, wiki/community sources
- [ ] (?) Verify the game accepts an edited save (user test on Android) — e.g. coins changed in both `ProfileSaveData.TotalCoins` and `ProgressionSaveData.TotalCoins`
- [ ] (?) Collect a PC/Steam save to confirm cross-platform parity

## Phase 3 — Editor UI (MVP) — shell done, unlock editors waiting for Phase 2
- [x] App shell: open file (picker + drag & drop), detect file type (profile / settings)
- [x] Overview: profile info, playtime, checksum status
- [x] Coins editor (keeps both TotalCoins fields in sync)
- [~] Unlock editors: toggles for entries already in the save work; adding new entries + "unlock all" needs ID lists (Phase 2)
- [x] Settings editor (generic fields, volume sliders)
- [x] Raw JSON view for everything else (lossless)
- [x] Export: download edited file + original backup, validate before download
- [x] Dark, game-flavored styling (no game assets; Silkscreen OFL pixel font); mobile friendly

## Phase 4 — Polish & release
- [ ] How-to page: where save files are on Android / PC / Switch, how to copy them back
- [ ] Error handling for unknown versions (`saveSystemVersion` ≠ 0.30.0 → warning)
- [ ] README with screenshots, disclaimer
- [ ] Release v1.0

## Open decisions
- (?) Feature scope for MVP — which edits matter most to the user?
- [x] Visual style: dark gothic panels, gold frames, blood-red accents (user: "im Design des Games")
