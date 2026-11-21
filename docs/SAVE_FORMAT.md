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
  - `GemFrequencies[{Key:"GemConfig_*",Value:int}]` = per-gem **rarity setting** (0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary). The game lets players change a gem's rarity; in saves without changes all 62 values equal the default rarity from the game data (`apk.gemRarity`). Not edited yet (format of changes to be confirmed).
  - `UnlockedGemRarities[{Key:"GemConfig_*",Value:[rarity]}]` = gems that are **unlocked** (can drop). Set together with the gem's unlock achievement; one achievement can unlock several gems (e.g. `DungeonAchievement_Gems_01_CompMF1F1` → Area, Armor, Might, Evolve, Amount, Draw). Double Damage needs no unlock.
  - `BuildingsVisited[{Key:"TownBuilding_*",Value:bool}]`, `DungeonsVisited[{Key:"Dungeon_*",Value:bool}]`
  - `SealedGems`, `PreviouslySealedGems`: probably **banned** gems (game feature) — empty in all saves so far, format unknown
  - `ChestsSpawned`, `IsTutorialComplete`, `IsWildCardTutorialComplete`, `UnlocksHideCompleted`, `HasUpgraded`
- `MetricsSaveData.collectionData[{collectionID, dictionarySaveData:{doubleMetrics[{ID,Value}], longMetrics[{ID,Value}]}}]` — statistics. collectionID 0 = lifetime, 1 = current/last run, 2 = probably current floor/encounter set, 3 = this turn, 4 = this encounter. doubleMetrics use full double precision (`72.767441860465112`) — preserved by the lossless parser.

### ID conventions
- Characters `FCC_<Name>`: 25 IDs = the 25 playable Crawlers listed on vampire.survivors.wiki (Crawlers:Characters). `FCC_Ambrojoe`, `FCC_Leda`, `FCC_BigTroubler` were added with the Death Parade update (2026-10-12). Secret `FCC_MissingNo` = MissingN0 (defeat Red Death). Internal IDs differ from display names in places (`FCC_Cavallo` = Yatta Cavallo, `FCC_Ramba` = Bianca Ramba, `FCC_OSole` = O'Sole Meeo, `FCC_BigTroubler` = Big Troubler); see `displayNames`, `hints`, `characterPrices` in `data/ids.json`. The wiki also lists an unused "Divano" (not present in saves).
- Cards `Card_<Type>_<n>_<Name>` — type letters seen: A (attack), D (defense), S (special), M (mana), B, E (pickups/coins), W (wild); some cards have no type (`Card_Confuse`, `Card_Shatter`, …)
- Achievements: `SimpleAchievement_`, `DungeonAchievement_`, `MetricAchievement_`, `PowerUpAchievement_`
- Known ID lists: `data/ids.json`, regenerated with `node tools/extract-ids.mjs <saves…>`

## Unlocks (from the game data)
`tools/extract-apk-ids.mjs` reads the APK (Unity 6000.0.62f1, IL2CPP, no type trees). It unpacks `data.unity3d`/`datapack.unity3d` (UnityFS/LZ4), parses the SerializedFiles (object tables, MonoScript class names) and resolves PPtr references between MonoBehaviours. Everything below is read from the game data, not guessed.

- **Content packs** = the game's databases: `BaseGame`, `Blueberries` (= Death Parade update: Ambrojoe, Leda, Big Troubler, Gallo Dungeons, Moongolow/Moongohigh, Galileo's Hand, Tappo) and `MoongolowTeaser` (??? dungeon, Seventh Trumpet). Only database-registered objects are used by the game.
- **Save IDs**: objects have an asset name and a separate save-ID field. They differ for 7 achievements (e.g. asset `…_MIssingNo` → ID `SimpleAchievement_Character_MissingNo`), for relics (`RelicConfig_Rilevatore` → ID `RelicConfig_DamageIndicators`, `RelicConfig_UltraOverkill` → `RelicConfig_UltimateOverkill`) and gems (`GemConfig_AddType_Armor` → `GemConfig_AddType_Defense`).
- **What unlocks what** (`apk.unlockedBy` / `apk.unlocks` in `data/ids.json`): content objects reference their unlock achievement.
  - Characters: `characterUnlocks` (all 25 confirmed; Antonio needs none). A character needs its unlock (shows up in the tavern) + `CharactersPurchased` (playable).
  - Power-ups: shop tier 1 = `MetricAchievement_PowerUpShop` (the shop building); tier 2 = `DungeonAchievement_Unlock_ShopTier2` (Amount, Crawler Slot, Cooldown); tier 3 = `…ShopTier3` (Banish, Curse, Magnet, Revival, Deal Count); Greed = `DungeonAchievement_Unlock_InlaidLibrary_02` (also unlocks Library West Wing); Skip = `DungeonAchievement_Unlock_DairyPlant_01` (also unlocks Dairy Plant). The wiki is wrong about Skip.
  - Relics: `SimpleAchievement_Relic_*` (`relicUnlocks`); starter relics (Deck Box, Milky Way Map, Rilevatore) need none.
  - Dungeons: `DungeonAchievement_Unlock_*`; Moongolow/Moongohigh (`Dungeon_Soda_01/02`) via `DungeonAchievement_MoonGolow_1/2_Unlock`; Teeny Bridge via a combined `Multi-Achievement_Unlock_TinyBridge` (parts: `…Unlock_TinyBridge_01` + demo).
  - Cards: 107 in the game (102 base game, 5 Death Parade), each linked to a `CardType` (Attack, Defense, Special = stat boost, Mana, Void = pickups, Debuff, Character) → `apk.cardTypes`. 61 cards have an unlock achievement; starter cards need none. Card asset names can differ from save IDs (asset `Card_A_2_Axe` → ID `Card_A_3_Axe`).
  - Gems, arcanas, cards, passive dungeon events (Gun for Hire, offering tables, chicken shop) and enemy encounters are linked the same way.
- **Unused content**: 5 arcanas are named "(DEPRECATED)" by the game; 2 relic configs are broken (`BraveStory` has save ID "GrimGrimoire", `MagicBanger` "RelicConfig"); unlocks that unlock nothing, are not on the wiki and never appear in saves are hidden in the editor (`hidden` in `data/ids.json`). 6 relics exist but nothing unlocks them (Darkasso, FCC Pamphlet, Possessed Sneakers, Rage Virus, Randomizer, Yellow Sign) → Experimental.

## SettingsData — `Data`
`Resolution`/`RefreshRate` (Unity Vector3 incl. derived `normalized`, `magnitude`, `sqrMagnitude`), volumes (float 0–1), many bool toggles, `LocaleIdentifier`, `InputActionBindings` (null), layout indices.

## Open questions
- Full ID lists still missing for relics, arcanas, dungeons, achievements (characters, cards, gems, power-ups are complete via `CardGemSlots`/`GemFrequencies`/`PowerUpEnabled`).
- Characters: `CharactersPurchased` alone is NOT enough (tested 2026-11-21: MissingN0 stayed unplayable). The character must also be unlocked via its achievement in `AchievementsUnlocked` (Antonio: `SimpleAchievement_Character_Antonio`). Exact IDs for the other characters unknown yet.
- Meaning of `CurrentState`, `PowerUpLevelsUnlocked` format, `SaveObjects` content during a run.
- Verified 2026-11-21 on Android with saves edited by InventoryCrawler: coins (+10k, spendable); power-up levels; unlock + purchase makes characters playable (MissingN0, Leda); shop tier 3 unlock shows tier-3 power-ups; Greed unlock; relic unlock (Guiding Light) shows as done in the Unlocks menu; all changes persist after a restart.
- Does the game reject a save on checksum mismatch, or just reset it? (untested)
- Same format on PC/Switch/Xbox/iOS?
