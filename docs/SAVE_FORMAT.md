# Vampire Crawlers save format

Status: reverse-engineered from two Android saves (`saveSystemVersion` 0.30.0; ~7 min and ~33 min playtime). Platform parity (PC/Switch/…) is assumed, not yet verified.

## Files
| File | Content |
|---|---|
| `SaveProfile0.save` | Profile / progression (slot 0; presumably `SaveProfile1`, `2` for other slots) |
| `SettingsData.save` | Options (volume, display, controls, locale) |

## Envelope
```json
{
  "Version": 1,
  "Checksum": "<base64 SHA-1>",
  "Data": { ... }
}
```
File uses 2-space indentation, LF line endings, no trailing newline.

## Checksum (verified on both files)
```
hashInput = Data serialized alone, 2-space indent, CRLF ("\r\n") line breaks,
            same key order and number literals as in the file
Checksum  = base64( SHA-1( UTF-8(hashInput) ) )
```
Equivalent shortcut: take the `Data` value's text from the file, remove one indentation level (2 spaces) from each line after the first, and replace `\n` with `\r\n`.

The game evidently re-serializes its object and compares, so output must match .NET/Newtonsoft formatting: floats always carry a decimal point (`1.0`, `0.7`, `2631.80542`), `null` literals, `true`/`false`.

## SaveProfile0 — `Data`
- `ProfileId`, `saveSystemVersion`, `BuildSKU`
- `GameSaveData.SaveObjects[]` — empty outside a run (probably in-run state; TODO)
- `ProfileSaveData` — `CurrentState`, `TotalCoins`, `MainCharacterId` (32-hex GUID), `SaveTimeStamp` (ISO UTC), `PlayTime` (.NET TimeSpan `hh:mm:ss.fffffff`), `SaveSlotIdx`
- `RunMetaSaveData` — `SelectedDungeonID`, `SelectedPartyFccIds[]` (e.g. `FCC_Antonio`), `ActiveArcanasIds[]`, `EquippedArcanaIds[]`, `EnabledRelics[{Key,Value:bool}]`, mode flags (`EndlessModeActive`, `HandSizeLimitActive`, `HurryModeActive`, `IsJewellerDisabled`)
- `ProgressionSaveData`
  - `TotalCoins` (duplicated in `ProfileSaveData.TotalCoins`; editor keeps both in sync — works in-game)
  - `CharactersPurchased[{Key:"FCC_*",Value:bool}]`
  - `PowerUpLevelsUnlocked[{Key:"PowerUp_*",Value:int level}]` — only bought power-ups appear (absent = level 0). 19 real power-ups (wiki: Crawlers:Power_Ups); ID ≠ name for `PowerUp_CharacterSlot` = Crawler Slot, `PowerUp_Speed` = Deal Count, `PowerUp_Cooldown` = +1 Mana. Max levels in `data/ids.json` → `powerUpMaxLevels` (all 19 confirmed against the in-game shop; Greed = 4). `PowerUp_Charm` is a dev leftover without effect → hidden. `PowerUpEnabled[{Key,Value:bool}]` lists the on/off state of all 20 entries
  - `AchievementsUnlocked[{Key,Value:bool}]` — prefixes `SimpleAchievement_`, `DungeonAchievement_`, `MetricAchievement_`
  - `DiscoveredCards["Card_*" | "FCC_*"]` — string list, characters appear here too
  - `CardGemSlots[{Key,Value:int}]` (100 entries) — **contains every card AND every character (`FCC_*`) in the game**, locked or not → our source for the full ID lists. Value probably = number of gem slots (e.g. `Card_B_0..3_EmptyTome` = 0..3)
  - `GemFrequencies[{Key:"GemConfig_*",Value:int}]` (62 gem types, values 0–4 — maybe rarity tier)
  - `UnlockedGemRarities[{Key:"GemConfig_*",Value:[int]}]` — list of unlocked rarities per gem
  - `BuildingsVisited[{Key:"TownBuilding_*",Value:bool}]`, `DungeonsVisited[{Key:"Dungeon_*",Value:bool}]`
  - `SealedGems`, `PreviouslySealedGems` (still empty — TODO)
  - `ChestsSpawned`, `IsTutorialComplete`, `IsWildCardTutorialComplete`, `UnlocksHideCompleted`, `HasUpgraded`
- `MetricsSaveData.collectionData[{collectionID, dictionarySaveData:{doubleMetrics[{ID,Value}], longMetrics[{ID,Value}]}}]` — statistics. collectionID 0 = lifetime, 1 = current/last run, 2 = probably current floor/encounter set, 3 = this turn, 4 = this encounter. doubleMetrics use full double precision (`72.767441860465112`) — preserved by the lossless parser.

### ID conventions
- Characters `FCC_<Name>`: 25 IDs = the 25 playable Crawlers listed on vampire.survivors.wiki (Crawlers:Characters). `FCC_Ambrojoe`, `FCC_Leda`, `FCC_BigTroubler` were added with the Death Parade update (2026-10-12). Secret `FCC_MissingNo` = MissingN0 (defeat Red Death). Internal IDs differ from display names in places (`FCC_Cavallo` = Yatta Cavallo, `FCC_Ramba` = Bianca Ramba, `FCC_OSole` = O'Sole Meeo, `FCC_BigTroubler` = Big Troubler); see `displayNames`, `hints`, `characterPrices` in `data/ids.json`. The wiki also lists an unused "Divano" (not present in saves).
- Cards `Card_<Type>_<n>_<Name>` — type letters seen: A (attack), D (defense), S (special), M (mana), B, E (pickups/coins), W (wild); some cards have no type (`Card_Confuse`, `Card_Shatter`, …)
- Achievements: `SimpleAchievement_`, `DungeonAchievement_`, `MetricAchievement_`, `PowerUpAchievement_`
- Known ID lists: `data/ids.json`, regenerated with `node tools/extract-ids.mjs <saves…>`

## Unlocks (from the game data)
`tools/extract-apk-ids.mjs` reads the APK (Unity 6000.0.62f1, IL2CPP; bundles `assets/bin/Data/data.unity3d` + `datapack.unity3d`, UnityFS/LZ4) and finds 257 achievement/unlock IDs, 30 relics, 22 arcanas, 19 dungeons, 8 town buildings, 26 characters (+`FCC_Divano`, unused). Every ID seen in real saves appears in the APK.

- Achievement objects have two name fields: asset name and save ID. They differ for 7 objects; the **second field is the save ID** (evidence: asset `DungeonAchievement_Unlock_TinyBridge_01_Demo` → ID `DungeonAchievement_Unlock_TinyBridge_01`). E.g. MissingNo: asset `…_MIssingNo` (typo), ID `SimpleAchievement_Character_MissingNo`.
- Characters: unlock achievement + purchase (see `characterUnlocks` in `data/ids.json`; Imelda = `DungeonAchievement_Inn`, Mortaccio = `…_Character_Mortuccio`, Ambrojoe = `MetricAchievement_Ambrojoe`).
- Power-up shop tiers: `MetricAchievement_PowerUpShop`, `DungeonAchievement_Unlock_ShopTier2`, `DungeonAchievement_Unlock_ShopTier3`.
- Relics: owned = unlock achievement `SimpleAchievement_Relic_*` (see `relicUnlocks`), switched on = `RunMetaSaveData.EnabledRelics[{Key:"RelicConfig_*",Value:true}]`. Starter relics (Deck Box, Milky Way Map, Rilevatore, Damage Indicators) need no unlock — real saves have them enabled without the achievement. Display names differ: `RelicConfig_PancakeOfPower` = Combo Stack, `_Blacksmith` = Stardust Anvil, `_Jeweller` = Lapidary Loupe.
- Dungeons: `DungeonAchievement_Unlock_*`.

## SettingsData — `Data`
`Resolution`/`RefreshRate` (Unity Vector3 incl. derived `normalized`, `magnitude`, `sqrMagnitude`), volumes (float 0–1), many bool toggles, `LocaleIdentifier`, `InputActionBindings` (null), layout indices.

## Open questions
- Full ID lists still missing for relics, arcanas, dungeons, achievements (characters, cards, gems, power-ups are complete via `CardGemSlots`/`GemFrequencies`/`PowerUpEnabled`).
- Characters: `CharactersPurchased` alone is NOT enough (tested 2026-11-21: MissingN0 stayed unplayable). The character must also be unlocked via its achievement in `AchievementsUnlocked` (Antonio: `SimpleAchievement_Character_Antonio`). Exact IDs for the other characters unknown yet.
- Meaning of `CurrentState`, `PowerUpLevelsUnlocked` format, `SaveObjects` content during a run.
- Verified 2026-11-21: a save edited with InventoryCrawler (coins +10k, checksum recomputed) loads on Android and the coins can be spent.
- Does the game reject a save on checksum mismatch, or just reset it? (untested)
- Same format on PC/Switch/Xbox/iOS?
