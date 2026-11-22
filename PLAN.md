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
- [x] Mid-run save documented (`GameSaveData.SaveObjects`: player state, deck/piles with gems, dungeon progress, encounter, RNG); round trip byte-identical
- [ ] (?) Run editor — decide scope with the user: low risk (run gold, HP, level/XP), medium (gems in deck cards), high (add/remove cards)
- [x] `data/ids.json` + `tools/extract-ids.mjs`: characters (25), cards (75), gems (62), power-ups (20) complete
- [x] Complete ID lists for all categories from the APK (database-registered content)
- [x] Game accepts an edited save: +10k coins (both TotalCoins fields) loaded on Android and spendable in-game (2026-11-21)
- [x] Character roster cross-checked with vampire.survivors.wiki: all 25 IDs are playable (3 from Death Parade update); display names, unlock hints, prices added
- [x] Characters grouped by content release (Base game 22, Death Parade update 3); unknown IDs fall into "New / not yet categorized"
- [x] Character unlocks verified from game data (unlock hint texts are from guides/wiki)
- Reference: https://vampire.survivors.wiki/w/Crawlers:Characters is the most reliable source (guides were incomplete/wrong)
- [x] In-game test: unlocking a character (unlock achievement + CharactersPurchased) (user test on Android) — e.g. coins changed in both `ProfileSaveData.TotalCoins` and `ProgressionSaveData.TotalCoins`
- [x] PC uses the same save folder layout and file names (confirmed path); a PC save sample would still be a nice extra check

## Phase 3 — Editor UI (MVP)
- [x] One tab per category: Overview · Characters · Relics · Power-ups · Cards · Achievements · Other · Raw JSON (Experimental sections live in their category tab)
- [x] App shell: open file (picker + drag & drop), detect file type (profile / settings)
- [x] Overview: profile info, playtime, checksum status
- [x] Coins editor (keeps both TotalCoins fields in sync)
- [x] Unlock editors: all characters, discovered cards, relics (search + All/None), power-up levels
- [x] Gems tab: 64 gems by rarity (from game data), check = UnlockedGemRarities [rarity] + unlock achievement (shared unlocks handled), 39 wiki names
- [x] Gem rarity setting + seal (Jeweller feature): selector + seal toggle per gem; editor output verified identical to a game-written save (Coin Count Gem rarity change, Decimate Gem sealed)
- [x] Card gem slots: max/default per card from game data (verified with an in-game Blacksmith save), editor with Max/Default per group and "Max all" (not part of "Unlock everything")
- [ ] In-game test: a gem unlocked via the editor drops in runs
- [x] Power-up max levels from shop screenshot
- [x] `PowerUp_Charm` = dev leftover without effect → hidden (`hidden` in `data/ids.json`). Collapsed "Experimental" section stays available via `experimental` map for future unconfirmed IDs
- [x] Settings editor (generic fields, volume sliders)
- [x] Raw JSON view for everything else (lossless)
- [x] Export: download edited file + original backup, validate before download
- [x] Dark, game-flavored styling (no game assets; Silkscreen OFL pixel font); mobile friendly

## Phase 3b — Category deep-dives (like Characters: full ID list, wiki names, hints, update groups)
- [x] Characters — confirmed in-game: unlock + purchase works. (Earlier: purchase alone is NOT enough (MissingN0 not playable). Each character also needs its unlock achievement (e.g. `SimpleAchievement_Character_Antonio`; Imelda via `DungeonAchievement_Inn`?). Wiki Crawlers:Unlocks lists ~182 unlocks by display name only, no internal IDs
- [x] In-game test power-ups: levels of already unlocked power-ups apply; locked ones (e.g. Deal Count, shop tier 3) stay hidden → power-ups also need their unlock
- [x] **Unlocks**: APK scan (`tools/extract-apk-ids.mjs`) → 257 unlock IDs; Characters tab sets unlock + purchase; power-up tiers have "Unlocked in shop"; Achievements tab lists all unlocks by category
- [x] In-game test 2026-11-21 (Android): MissingN0 + Leda playable after unlock + purchase; ShopTier3 unlock shows all tier-3 power-ups, Deal Count (glove icon) at level 1; Greed visible after its unlock (side effect confirmed: Library West Wing became selectable on the world map); Guiding Light relic unlock marked done in the Unlocks menu; everything persists after restarting the game
- [x] Wiki cross-check (data/wiki-unlocks.json, 182 wiki unlocks): 159 matched directly, rest classified → 218 regular unlocks (with wiki requirement tooltips), 36 experimental, placeholders hidden
- [x] Useless entries identified from the game data (unlock links + databases + DEPRECATED flags) and hidden; 7 doubtful left in Experimental
- [x] Greed = `DungeonAchievement_Unlock_InlaidLibrary_02`, Skip = `DungeonAchievement_Unlock_DairyPlant_01` (from game data)
- [x] Relics tab: 19 wiki relics (names, effects, unlock + enable), 11 unknown relics in Experimental
- [x] Full internal ID lists from the APK (all save IDs cross-checked)
- [x] Power-ups: wiki names/effects/base prices, grouped by shop tier, Max/Reset per group
- [x] Greed max level = 4 (confirmed by user; wiki Crawlers:Power_Ups matches the game)
- [x] In-game: edited power-up levels are accepted; PowerUp_Speed = Deal Count confirmed
- [x] In-game test 2026-11-21: a save with EVERYTHING unlocked via the editor (all categories) loads fine and shows everything unlocked
- [ ] Optional: check "Refund Power Ups" refunds edited levels sensibly
- [x] Shop-tier grouping now from game data (effects/base prices still wiki only)
- [x] Relics
- [x] Cards: all 107 cards from game data, grouped by card type (Attack, Defense, Stat boost, Mana, Pickups, Debuff, Crawler cards), check = discovered + unlock, links to unlocks
- [x] Achievements: all unlocks from game data, categories, wiki requirements, what each unlock unlocks

## Phase 4 — Polish & release
- [x] How-to page (howto.html): quick guide, files, Android (USB/Shizuku/root; package com.poncle.vampirecrawlers from the APK), PC/Steam, iOS, consoles, troubleshooting; linked from start screen + footer
- [x] Save folders confirmed by players: Android `Android/data/com.poncle.vampirecrawlers/files/Save/`, PC `%USERPROFILE%\AppData\LocalLow\Nosebleed Interactive\Vampire Crawlers\Save\`
- [ ] (later, low priority) iOS: how to get the save out of the game and back
  - Android path: `Android/data/com.poncle.vampirecrawler/…`. Android 11+ blocks third-party file managers from writing there → document: USB + PC (works), system "Files" app (device-dependent), Shizuku + ZArchiver/MiXplorer/Material Files (on-device)
- [x] Warning badge + toast for untested save versions (`testedSaveVersions` in data/ids.json; currently 0.30.0 = game 1.6.5)
- [x] README with features, screenshots (synthetic save), how-to, privacy, credits, disclaimer
- [x] Release v1.0.0 (2026-11-22)

## Open decisions
- (?) Feature scope for MVP — which edits matter most to the user?
- [x] Visual style: dark gothic panels, gold frames, blood-red accents (user: "im Design des Games")
