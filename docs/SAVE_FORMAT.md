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
  - `TotalCoins` (also duplicated in `ProfileSaveData.TotalCoins` — keep in sync? TODO)
  - `CharactersPurchased[{Key:"FCC_*",Value:bool}]`
  - `PowerUpLevelsUnlocked[{Key:"PowerUp_*",Value:int level}]` — only bought power-ups appear (absent = level 0). Max levels (from the shop UI, see `data/ids.json` → `powerUpMaxLevels`): 5 = Area, Banish, Curse, Duration, Growth, Luck, MaxHealth, Might, Reroll, Skip; 3 = Amount, Armor, Greed, Recovery; 2 = CharacterSlot, Cooldown, Speed; 1 = Magnet, Revival. `PowerUp_Charm` is a development leftover without any effect → hidden in the editor (`data/ids.json` → `hidden`), left untouched in the file. `PowerUpEnabled[{Key,Value:bool}]` lists all 20 power-ups
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
- Characters `FCC_<Name>` (25 known; `FCC_MissingNo` looks like a secret/glitch character)
- Cards `Card_<Type>_<n>_<Name>` — type letters seen: A (attack), D (defense), S (special), M (mana), B, E (pickups/coins), W (wild); some cards have no type (`Card_Confuse`, `Card_Shatter`, …)
- Achievements: `SimpleAchievement_`, `DungeonAchievement_`, `MetricAchievement_`, `PowerUpAchievement_`
- Known ID lists: `data/ids.json`, regenerated with `node tools/extract-ids.mjs <saves…>`

## SettingsData — `Data`
`Resolution`/`RefreshRate` (Unity Vector3 incl. derived `normalized`, `magnitude`, `sqrMagnitude`), volumes (float 0–1), many bool toggles, `LocaleIdentifier`, `InputActionBindings` (null), layout indices.

## Open questions
- Full ID lists still missing for relics, arcanas, dungeons, achievements (characters, cards, gems, power-ups are complete via `CardGemSlots`/`GemFrequencies`/`PowerUpEnabled`).
- Is buying a character just `CharactersPurchased`, or does the shop also need an unlock achievement?
- Meaning of `CurrentState`, `PowerUpLevelsUnlocked` format, `SaveObjects` content during a run.
- Does the game reject a save on checksum mismatch, or just reset it?
- Same format on PC/Switch/Xbox/iOS?
