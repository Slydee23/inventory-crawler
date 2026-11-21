# Vampire Crawlers save format

Status: reverse-engineered from an Android save (`saveSystemVersion` 0.30.0, ~7 min playtime, tutorial done). Platform parity (PC/Switch/…) is assumed, not yet verified.

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
  - `PowerUpLevelsUnlocked[]` (empty so far — TODO), `PowerUpEnabled[{Key:"PowerUp_*",Value:bool}]` (20 entries)
  - `AchievementsUnlocked[{Key,Value:bool}]` — prefixes `SimpleAchievement_`, `DungeonAchievement_`, `MetricAchievement_`
  - `DiscoveredCards["Card_<rarity>_<n>_<Name>"]`
  - `CardGemSlots[{Key:"Card_*",Value:int}]` (100 entries), `GemFrequencies[{Key:"GemConfig_*",Value:int}]` (62)
  - `SealedGems`, `PreviouslySealedGems`, `UnlockedGemRarities`, `BuildingsVisited`, `DungeonsVisited` (all empty so far — TODO)
  - `ChestsSpawned`, `IsTutorialComplete`, `IsWildCardTutorialComplete`, `UnlocksHideCompleted`, `HasUpgraded`
- `MetricsSaveData.collectionData[{collectionID, dictionarySaveData:{doubleMetrics[{ID,Value}], longMetrics[{ID,Value}]}}]` — statistics (damage, discoveries, …)

## SettingsData — `Data`
`Resolution`/`RefreshRate` (Unity Vector3 incl. derived `normalized`, `magnitude`, `sqrMagnitude`), volumes (float 0–1), many bool toggles, `LocaleIdentifier`, `InputActionBindings` (null), layout indices.

## Open questions
- Full ID lists (all characters, cards, relics, arcanas, power-ups, gems, dungeons, achievements) — the save only lists what is unlocked/seen.
- Meaning of `CurrentState`, `PowerUpLevelsUnlocked` format, `SaveObjects` content during a run.
- Does the game reject a save on checksum mismatch, or just reset it?
- Same format on PC/Switch/Xbox/iOS?
