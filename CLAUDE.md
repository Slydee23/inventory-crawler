# InventoryCrawler — A Vampire Crawlers Save Editor

Browser-based save editor for the game *Vampire Crawlers* (poncle, Unity). Product name: **InventoryCrawler**. Repo: `Slydee23/inventory-crawler`, live at https://slydee23.github.io/inventory-crawler/ (GitHub Pages, `main` branch, repo root). Runs 100% client-side: the user opens a `.save` file, edits it, downloads the modified file. No server, no uploads, no tracking.

## Working with the user
- The user speaks German: talk to them in German. Everything in the product (UI text, code, comments, commits, README) is **English**.
- Ask whenever something is unclear rather than guessing — especially about game semantics of save fields.
- Track progress in `PLAN.md`: tick off tasks when they are done, add newly discovered tasks there.

## Tech stack
- **Vanilla HTML/CSS/JavaScript, ES modules, no build step, no runtime dependencies.** The repo root is served by GitHub Pages as-is (`.nojekyll` present). Use relative URLs only (site lives under `/inventory-crawler/`).
- Node.js (installed at `C:\Program Files\nodejs`) is a **dev-only** tool for tests and a local server. Never make the site depend on Node, npm packages or a bundler.
- Tests: `node --test` (built-in runner), no test frameworks.
- Use JSDoc type annotations in JS for editor support instead of TypeScript.

## Save format — critical rules (details in `docs/SAVE_FORMAT.md`)
- Files are pretty-printed JSON: `{ "Version", "Checksum", "Data" }`.
- `Checksum = base64(SHA-1(utf8(serialize(Data))))` where `serialize` = Newtonsoft-style indented JSON, 2-space indent, **CRLF** line endings, `Data` serialized on its own (not nested). Verified on `SaveProfile0.save` and `SettingsData.save`.
- **Never use `JSON.parse`/`JSON.stringify` for the write path.** They lose number formatting (`2400.0` → `2400`), which breaks the checksum. Use the project's lossless JSON parser/serializer that keeps every number's original literal text and key order.
- New float values must be written the way .NET writes them (always with a decimal point, e.g. `1.0`); ints stay ints. Don't change a field's type.
- The written file must keep the original layout (2-space indent, LF line endings in the file itself, no trailing newline) — only the hash input uses CRLF.
- Many collections are `[{ "Key": ..., "Value": ... }]` lists (serialized dictionaries). Unlocks are usually "present with Value true"; adding entries must use exact game IDs.
- Golden test: parse → serialize unchanged must reproduce the original file byte-for-byte and the same checksum. Every format change must keep this test green.

## Privacy / repo hygiene
- Real save files live in `samples/` and `VC Save/` — both are gitignored. **Never commit real saves** (they may contain account-specific data). Test fixtures in the repo must be synthetic or explicitly approved by the user.
- Commit/push only when the user asks or a PLAN.md phase is finished and agreed.

## Safety for users
- Always let users download a backup of the original file before/alongside the edited one.
- Validate before export: re-parse the output and verify the checksum.
- Unknown fields must round-trip untouched (raw JSON view as fallback editor).

## Layout (target)
```
index.html          app shell
css/                styles
js/                 ES modules (json-lossless, checksum, save-model, ui/*)
data/               known game IDs (characters, cards, relics, ...) as JSON
tests/              node --test files + synthetic fixtures
docs/SAVE_FORMAT.md format documentation
PLAN.md             project plan & progress
```

## Game data & new game updates
- Known IDs, names, hints, prices and content groups live in `data/ids.json` (no code changes needed for new content).
- Most reliable reference: https://vampire.survivors.wiki/w/Crawlers:Characters (online guides were outdated/wrong).
- When the game gets an update:
  1. Put the new APK into `game-files/` (gitignored, never commit game files) and run `node --max-old-space-size=6000 tools/extract-apk-ids.mjs game-files/<file>.apk --write` → refreshes `apk` in `data/ids.json`: database-registered IDs per content pack, save IDs, what unlocks what (`unlockedBy`/`unlocks`), deprecated content. Then re-check `hidden`/`experimental`, `characterUnlocks`, `relicUnlocks`, `powerUpGroups` against the new `apk` data. Also run `node tools/extract-ids.mjs <save…>` on a save from the new version and check every save ID appears in the APK lists.
  2. New characters show up in the editor under "New / not yet categorized" automatically.
  3. Add a group to `characterGroups` (`{ "name": "<Update> update", "released": "YYYY-MM-DD", "ids": [...] }`), plus `displayNames`, `hints`, `characterPrices` from the wiki.
  5. After testing a save from the new game version in-game, add its `saveSystemVersion` to `testedSaveVersions` in `data/ids.json` (and update `testedGameVersion`, README).
  4. New characters also need an entry in `characterUnlocks` (unlock achievement). Unconfirmed IDs → `experimental`; unused/dev leftovers → `hidden` (never shown, kept in the file).
- Unlock model: almost everything is gated by entries in `AchievementsUnlocked`. A character needs its unlock achievement AND `CharactersPurchased`; a power-up tier needs `MetricAchievement_PowerUpShop` / `DungeonAchievement_Unlock_ShopTier2/3`.

## Commands
- **Before every commit that changes js/, css/ or data/:** `node tools/stamp-version.mjs` (cache busting: GitHub Pages lets browsers cache 10 min; this stamps a content hash into index.html import map + URLs). `tests/version.test.js` fails if forgotten.
- Run tests: `node --test tests/`
- Local preview: `npx --yes http-server -c-1 .` (or any static server; ES modules don't work from `file://`)
