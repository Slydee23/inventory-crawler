// Collect known game IDs from one or more local save files into data/ids.json.
// Usage: node tools/extract-ids.mjs <save> [<save> ...]
// Merges with the existing data/ids.json, so IDs are never lost.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = new URL('../data/ids.json', import.meta.url);
const ids = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const add = (cat, list) => { ids[cat] = [...new Set([...(ids[cat] ?? []), ...list.filter(Boolean)])].sort(); };
const keys = (list) => (Array.isArray(list) ? list.map((e) => e.Key) : []);

for (const file of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(file, 'utf8')).Data;
  const p = d.ProgressionSaveData ?? {};
  const r = d.RunMetaSaveData ?? {};
  const slots = keys(p.CardGemSlots);
  add('characters', [...slots, ...keys(p.CharactersPurchased), ...(r.SelectedPartyFccIds ?? [])].filter((k) => k.startsWith('FCC_')));
  add('cards', [...slots, ...(p.DiscoveredCards ?? [])].filter((k) => k.startsWith('Card_')));
  add('gems', [...keys(p.GemFrequencies), ...keys(p.UnlockedGemRarities)]);
  add('powerUps', [...keys(p.PowerUpEnabled), ...keys(p.PowerUpLevelsUnlocked)]);
  add('relics', keys(r.EnabledRelics));
  add('dungeons', [...keys(p.DungeonsVisited), r.SelectedDungeonID]);
  add('buildings', keys(p.BuildingsVisited));
  add('achievements', keys(p.AchievementsUnlocked));
  add('arcanas', [...(r.ActiveArcanasIds ?? []), ...(r.EquippedArcanaIds ?? [])]);
}
writeFileSync(OUT, JSON.stringify(ids, null, 2) + '\n');
console.log(Object.entries(ids).map(([k, v]) => `${k}: ${v.length}`).join(', '));
