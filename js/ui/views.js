// Editor views. Each view is a function (ctx) => HTMLElement.
// ctx = { save: SaveFile, ids: KnownIds, changed(): void, toast(msg, isError?): void }

import { h, prettify, formatDuration } from './dom.js';
import { JsonNumber, stringify, parse } from '../json-lossless.js';
import { getIn, parseTimeSpan, kvGet, kvSet, kvDelete } from '../save-file.js';

const INT32_MAX = 2147483647;

// ---------------------------------------------------------------- generic building blocks

/** Panel with gold frame and title. */
function panel(title, subtitle, ...content) {
  return h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, title, subtitle && h('small', null, subtitle)),
    ...content);
}

/**
 * Editable form for all primitive fields (bool / number / string / null) of a Map.
 * Nested objects and arrays are skipped (handled by dedicated views or Raw JSON).
 */
function fieldsEditor(map, ctx, { exclude = [] } = {}) {
  const rows = [];
  for (const [key, value] of map) {
    if (exclude.includes(key)) continue;
    const label = h('span', { class: 'field-label' }, prettify(key), h('small', null, key));
    let input = null;

    if (typeof value === 'boolean') {
      input = h('input', {
        type: 'checkbox', checked: value,
        onchange: (e) => { map.set(key, e.target.checked); ctx.changed(); },
      });
    } else if (value instanceof JsonNumber) {
      const isVolume = /Volume$/.test(key) && value.isFloat;
      if (isVolume) {
        const out = h('span', { class: 'badge' }, `${Math.round(value.value * 100)}%`);
        input = h('span', { class: 'field-control' },
          h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: String(value.value),
            oninput: (e) => {
              map.set(key, JsonNumber.float32(Number(e.target.value)));
              out.textContent = `${Math.round(Number(e.target.value) * 100)}%`;
              ctx.changed();
            },
          }), ' ', out);
      } else {
        input = h('input', {
          type: 'number', value: value.raw, step: value.isFloat ? 'any' : '1',
          onchange: (e) => {
            const n = Number(e.target.value);
            if (e.target.value === '' || !Number.isFinite(n)) {
              e.target.value = map.get(key).raw;
              ctx.toast(`${prettify(key)}: invalid number`, true);
              return;
            }
            map.set(key, map.get(key).withValue(n));
            e.target.value = map.get(key).raw;
            ctx.changed();
          },
        });
      }
    } else if (typeof value === 'string') {
      input = h('input', {
        type: 'text', value,
        onchange: (e) => { map.set(key, e.target.value); ctx.changed(); },
      });
    } else if (value === null) {
      input = h('span', { class: 'badge' }, 'null');
    } else {
      continue; // object / array
    }
    rows.push(h('label', { class: 'field' }, label, input));
  }
  return rows.length ? h('div', { class: 'fields' }, rows) : h('p', { class: 'empty' }, 'No simple fields.');
}

/**
 * Toggle list for a `[{Key, Value: bool}]` dictionary.
 * @param {{ keep?: (key: string) => boolean }} [opts] filter which entries are shown
 */
function kvToggleList(list, ctx, { keep = () => true } = {}) {
  if (!Array.isArray(list) || list.length === 0) {
    return h('p', { class: 'empty' }, 'Nothing here yet.');
  }
  const items = list
    .filter((e) => e instanceof Map && typeof e.get('Value') === 'boolean' && keep(e.get('Key')))
    .map((entry) => h('label', { class: 'toggle' },
      h('input', {
        type: 'checkbox', checked: entry.get('Value'),
        onchange: (e) => { entry.set('Value', e.target.checked); ctx.changed(); },
      }),
      h('span', null, prettify(entry.get('Key')), h('small', null, entry.get('Key')))));
  return h('div', { class: 'toggle-list' }, items);
}

/** Sorted union of known IDs and IDs found in the save. */
function union(...lists) {
  return [...new Set(lists.flat().filter((x) => typeof x === 'string'))]
    .sort((a, b) => prettify(a).localeCompare(prettify(b)));
}

/**
 * Checklist over a set of IDs with search and select-all / select-none.
 * @param {{ ids: string[], isOn: (id: string) => boolean, set: (id: string, on: boolean) => void,
 *           warnOn?: Record<string, string>, hints?: Record<string, string>, onCount?: (text: string) => void,
 *           links?: Record<string, { label: string, title?: string, go: () => void }> }} opts
 *   warnOn: risky IDs (⚠, skipped by "All"); hints: informational tooltip text
 */
function idChecklist(ctx, { ids, isOn, set, warnOn = {}, hints = {}, onCount, links = {} }) {
  const list = h('div', { class: 'toggle-list' });
  const counter = h('span', { class: 'badge' });
  let filter = '';

  const updateCount = () => {
    counter.textContent = `${ids.filter(isOn).length} / ${ids.length}`;
    onCount?.(counter.textContent);
  };
  const render = () => {
    const q = filter.toLowerCase();
    list.replaceChildren(...ids
      .filter((id) => !q || id.toLowerCase().includes(q) || prettify(id).toLowerCase().includes(q))
      .map((id) => h('label', { class: 'toggle', title: warnOn[id] ?? hints[id] ?? id, 'data-id': id },
        h('input', {
          type: 'checkbox', checked: isOn(id),
          onchange: (e) => { set(id, e.target.checked); updateCount(); ctx.changed(); },
        }),
        h('span', null, prettify(id), warnOn[id] && ' ⚠', h('small', null, id),
          links[id] && h('a', {
            class: 'tile-link', href: '#', title: links[id].title ?? '',
            onclick: (e) => { e.preventDefault(); e.stopPropagation(); links[id].go(); },
          }, links[id].label)))));
    updateCount();
  };
  const setAll = (on) => {
    const targets = ids.filter((id) => !(on && warnOn[id])); // never bulk-enable risky entries
    for (const id of targets) if (isOn(id) !== on) set(id, on);
    render();
    ctx.changed();
  };

  render();
  return h('div', null,
    h('div', { class: 'list-tools' },
      ids.length > 12 && h('input', {
        type: 'search', placeholder: 'Search…', 'aria-label': 'Search',
        oninput: (e) => { filter = e.target.value; render(); },
      }),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => setAll(true) }, 'All'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => setAll(false) }, 'None'),
      counter),
    list);
}

/**
 * Split IDs into content groups (base game, each update …) and render each with `renderList`.
 * IDs that belong to no group end up in "New / not yet categorized", so new updates show up.
 * @param {string[]} allIds
 * @param {{ name: string, released?: string, ids: string[] }[] | undefined} groups
 * @param {(ids: string[], group?: object) => HTMLElement} renderList
 */
const groupOpenState = new Map(); // remembers expanded/collapsed groups across re-renders

function groupedSections(allIds, groups, renderList, { key = '', open = true } = {}) {
  if (!Array.isArray(groups) || groups.length === 0) return renderList(allIds);
  const sections = [];
  const assigned = new Set();
  for (const g of groups) {
    const members = allIds.filter((id) => g.ids.includes(id));
    members.forEach((id) => assigned.add(id));
    if (members.length) sections.push({ name: g.name, released: g.released, members, group: g });
  }
  const rest = allIds.filter((id) => !assigned.has(id));
  if (rest.length) sections.push({ name: 'New / not yet categorized', members: rest });
  const details = sections.map((s) => {
    const stateKey = `${key}:${s.name}`;
    const count = h('span', { class: 'group-count badge' });
    const el = h('details', {
      class: 'group', open: groupOpenState.get(stateKey) ?? open,
      ontoggle: (e) => groupOpenState.set(stateKey, e.target.open),
    },
      h('summary', { class: 'sub-title' }, s.name, s.released && h('small', null, ` · ${s.released}`), ' ', count),
      renderList(s.members, s.group, (text) => { count.textContent = text; }));
    return el;
  });
  const setAll = (open) => details.forEach((d) => { d.open = open; });
  return h('div', { class: 'groups' },
    details.length > 3 && h('div', { class: 'list-tools' },
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => setAll(true) }, 'Expand all'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => setAll(false) }, 'Collapse all')),
    details);
}

/**
 * Number inputs for a `[{Key, Value: int}]` dictionary; 0 removes the entry.
 * "Max" sets every entry with a known maximum to it; "Reset" sets all to 0.
 * @param {Record<string, number>} maxById known maximum per ID; others use `fallbackMax` and get a ⚠
 * @param {Record<string, string>} [hints] tooltip text per ID
 */
function kvLevelList(ctx, list, ids, maxById, fallbackMax, hints = {}, onCount) {
  const levelOf = (id) => {
    const v = kvGet(list, id);
    return v instanceof JsonNumber ? v.value : 0;
  };
  const setLevel = (id, n) => {
    if (n === 0) kvDelete(list, id);
    else kvSet(list, id, JsonNumber.int(n));
  };
  const inputs = new Map();
  const updateCount = () => onCount?.(`${ids.filter((id) => levelOf(id) > 0).length} / ${ids.length}`);
  const rows = ids.map((id) => {
    const known = Number.isInteger(maxById[id]);
    const max = known ? maxById[id] : fallbackMax;
    const input = h('input', {
      type: 'number', min: '0', max: String(max), step: '1', value: String(levelOf(id)),
      onchange: (e) => {
        const n = Number(e.target.value);
        if (!Number.isInteger(n) || n < 0 || n > max) {
          ctx.toast(`${prettify(id)}: enter a whole number from 0 to ${max}`, true);
          e.target.value = String(levelOf(id));
          return;
        }
        setLevel(id, n);
        updateCount();
        ctx.changed();
      },
    });
    inputs.set(id, input);
    return h('label', { class: 'field', title: hints[id] ?? (known ? `Max level ${max}` : 'Max level unknown') },
      h('span', { class: 'field-label' },
        prettify(id), known ? ` (max ${max})` : ' ⚠', h('small', null, id)),
      input);
  });
  const setAll = (pick) => {
    for (const id of ids) {
      const n = pick(id);
      if (n === null || n === levelOf(id)) continue;
      setLevel(id, n);
      inputs.get(id).value = String(n);
    }
    updateCount();
    ctx.changed();
  };
  updateCount();
  return h('div', null,
    h('div', { class: 'list-tools' },
      h('button', {
        class: 'btn btn-small', type: 'button', title: 'Set every power-up with a known maximum to its max level',
        onclick: () => setAll((id) => (Number.isInteger(maxById[id]) ? maxById[id] : null)),
      }, 'Max'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => setAll(() => 0) }, 'Reset')),
    h('div', { class: 'fields' }, rows));
}

function stat(label, value) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value ?? '—'));
}

// ---------------------------------------------------------------- profile views

function goldEditor(ctx) {
  const d = ctx.save.data;
  // Gold is stored twice (ProfileSaveData/ProgressionSaveData.TotalCoins); keep both in sync.
  const paths = [['ProfileSaveData', 'TotalCoins'], ['ProgressionSaveData', 'TotalCoins']]
    .filter((p) => getIn(d, ...p) instanceof JsonNumber);
  if (!paths.length) return null;
  const current = getIn(d, ...paths[0]).value;

  const input = h('input', { type: 'number', min: '0', max: String(INT32_MAX), step: '1', value: String(current), 'aria-label': 'Gold' });
  const apply = (n) => {
    if (!Number.isInteger(n) || n < 0 || n > INT32_MAX) {
      ctx.toast(`Gold must be a whole number between 0 and ${INT32_MAX.toLocaleString('en')}`, true);
      input.value = String(getIn(d, ...paths[0]).value);
      return;
    }
    for (const p of paths) getIn(d, ...p.slice(0, -1)).set(p[p.length - 1], JsonNumber.int(n));
    input.value = String(n);
    ctx.changed();
  };
  input.addEventListener('change', () => apply(Number(input.value)));

  return h('section', { class: 'panel gold-panel' },
    h('h2', { class: 'panel-title' }, 'Gold'),
    h('div', { class: 'coins' },
      h('span', { class: 'coin-icon', 'aria-hidden': 'true' }),
      input,
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(Number(input.value) + 10000) }, '+10k'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(Number(input.value) + 100000) }, '+100k'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(999999) }, '999,999')),
    h('p', { class: 'note' }, 'Your gold in the village. Updates both gold counters stored in the save.'));
}

function profileOverview(ctx) {
  const d = ctx.save.data;
  const p = d.get('ProfileSaveData');
  const prog = d.get('ProgressionSaveData');
  let playtime = null;
  try { playtime = formatDuration(parseTimeSpan(p?.get('PlayTime'))); } catch { /* unknown format */ }
  const saved = p?.get('SaveTimeStamp') ? new Date(p.get('SaveTimeStamp')).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : null;
  const count = (list) => (Array.isArray(list) ? list.filter((e) => !(e instanceof Map) || e.get('Value') !== false).length : null);

  return h('div', null,
    goldEditor(ctx),
    panel('Profile', null, h('div', { class: 'stats' },
      stat('Profile', d.get('ProfileId')),
      stat('Save system', d.get('saveSystemVersion')),
      stat('Play time', playtime),
      stat('Last saved', saved),
      stat('Characters', count(prog?.get('CharactersPurchased'))),
      stat('Cards discovered', count(prog?.get('DiscoveredCards'))),
      stat('Achievements', count(prog?.get('AchievementsUnlocked'))),
      stat('Dungeon', prettify(getIn(d, 'RunMetaSaveData', 'SelectedDungeonID') ?? '—')))));
}

// ---------------------------------------------------------------- cross-links

/** { a: b } -> { b: a } */
function invert(map) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([k, val]) => [val, k]));
}

/** Tile links for every id in `list` that has a target in `targetById` (opens `tab` at that target). */
function linksTo(ctx, list, targetById, tab, label) {
  if (!ctx.navigate) return {};
  return Object.fromEntries(list.filter((id) => targetById[id]).map((id) => [id, {
    label,
    title: `Go to ${prettify(targetById[id])} (${targetById[id]})`,
    go: () => ctx.navigate(tab, targetById[id]),
  }]));
}

// ---------------------------------------------------------------- progression helpers

/**
 * Shared context for the progression tabs (characters, relics, power-ups, cards, …).
 * @returns {null | object} null if the save has no ProgressionSaveData
 */
function progression(ctx) {
  const prog = ctx.save.data.get('ProgressionSaveData');
  if (!(prog instanceof Map)) return null;
  const run = ctx.save.data.get('RunMetaSaveData');
  const ids = ctx.ids;
  const arr = (map, key) => (map instanceof Map && Array.isArray(map.get(key)) ? map.get(key) : null);
  const kvKeys = (list) => (list ?? []).map((e) => e instanceof Map && e.get('Key'));
  // Experimental IDs (in the save but unconfirmed in the game) get a collapsed section per tab.
  // Hidden IDs (dev leftovers without effect) are never shown; they still round-trip untouched.
  const experimental = ids.experimental ?? {};
  const isHidden = (id) => Object.hasOwn(ids.hidden ?? {}, id);
  return {
    prog, run, ids, arr, kvKeys, experimental,
    slotIds: kvKeys(arr(prog, 'CardGemSlots')),
    achievements: arr(prog, 'AchievementsUnlocked'),
    isHidden,
    isExperimental: (id) => Object.hasOwn(experimental, id) && !isHidden(id),
    isRegular: (id) => !Object.hasOwn(experimental, id) && !isHidden(id),
  };
}

function notInSave(title) {
  return panel(title, null, h('p', { class: 'empty' }, 'Not found in this save.'));
}

/** Collapsed "Experimental" panel listing unconfirmed IDs with their editors. */
function experimentalPanel(p, idList, ...editors) {
  if (idList.length === 0) return null;
  return h('details', { class: 'panel experimental' },
    h('summary', { class: 'panel-title' }, 'Experimental', h('small', null, 'unused or unconfirmed game data')),
    h('p', { class: 'warn-box' },
      '⚠ These entries exist in the save but are not confirmed to work in the game. Changing them may do nothing — or break your save. Keep a backup.'),
    h('ul', { class: 'exp-list' },
      idList.map((id) => h('li', { class: 'note' }, h('code', null, id), ` — ${p.experimental[id]}`))),
    ...editors);
}

// ---------------------------------------------------------------- progression tabs

function charactersView(ctx) {
  const p = progression(ctx);
  const chars = p && p.arr(p.prog, 'CharactersPurchased');
  if (!chars) return notInSave('Characters');
  // Present with Value true = purchased. Removing deletes the entry (as in a fresh save).
  const all = union(p.ids.characters, p.kvKeys(chars), p.slotIds.filter((k) => k?.startsWith('FCC_'))).filter((id) => !p.isHidden(id));
  // A character needs its unlock achievement (shows up in the tavern) AND the purchase.
  const unlocks = p.ids.characterUnlocks ?? {};
  const ach = p.achievements;
  const isUnlocked = (id) => !unlocks[id] || !ach || kvGet(ach, unlocks[id]) === true;
  const checklist = (list, _group, onCount) => idChecklist(ctx, {
    ids: list,
    onCount,
    isOn: (id) => kvGet(chars, id) === true && isUnlocked(id),
    set: (id, on) => {
      if (on) kvSet(chars, id, true); else kvDelete(chars, id);
      if (unlocks[id] && ach) { if (on) kvSet(ach, unlocks[id], true); else kvDelete(ach, unlocks[id]); }
    },
    hints: Object.fromEntries(list.map((id) => [id,
      [p.ids.hints?.[id], unlocks[id] && `Sets: purchase + ${unlocks[id]}`].filter(Boolean).join(' · ')])),
    links: linksTo(ctx, list, unlocks, 'achievements', '→ Unlock'),
  });
  const exp = all.filter(p.isExperimental);
  return h('div', null,
    panel('Characters', 'CharactersPurchased',
      groupedSections(all.filter(p.isRegular), p.ids.characterGroups, checklist, { key: 'characters' }),
      h('p', { class: 'note' }, 'Checking a character sets two things: its unlock (the character shows up in the tavern) and its purchase (it becomes playable). Use "→ Unlock" to see the linked unlock. Keep at least one character.')),
    experimentalPanel(p, exp, checklist(exp)));
}

function relicsView(ctx) {
  const p = progression(ctx);
  const relics = p && p.arr(p.run, 'EnabledRelics');
  if (!relics) return notInSave('Relics');
  // A relic needs its unlock achievement (owned) AND an EnabledRelics entry (Value = switched on).
  const unlocks = p.ids.relicUnlocks ?? {};
  const ach = p.achievements;
  const owned = (id) => !unlocks[id] || !ach || kvGet(ach, unlocks[id]) === true;
  const all = union(p.ids.relics, p.kvKeys(relics)).filter((id) => id && !p.isHidden(id));
  const checklist = (list, _group, onCount) => idChecklist(ctx, {
    ids: list,
    onCount,
    isOn: (id) => kvGet(relics, id) === true && owned(id),
    set: (id, on) => {
      if (on) kvSet(relics, id, true); else kvDelete(relics, id);
      if (unlocks[id] && ach) { if (on) kvSet(ach, unlocks[id], true); else kvDelete(ach, unlocks[id]); }
    },
    hints: Object.fromEntries(list.map((id) => [id,
      [p.ids.hints?.[id], unlocks[id] ? `Sets: ${unlocks[id]} + enabled` : 'Sets: enabled'].filter(Boolean).join(' · ')])),
    links: linksTo(ctx, list, unlocks, 'achievements', '→ Unlock'),
  });
  const exp = all.filter(p.isExperimental);
  return h('div', null,
    panel('Relics', 'EnabledRelics',
      groupedSections(all.filter(p.isRegular), p.ids.relicGroups, checklist, { key: 'relics' }),
      h('p', { class: 'note' }, 'Checking a relic unlocks it and switches it on. Hover a relic for its effect and where it is found (from the wiki).')),
    experimentalPanel(p, exp, checklist(exp)));
}

function powerUpsView(ctx) {
  const p = progression(ctx);
  if (!p) return notInSave('Power-ups');
  // Levels: [{Key, Value: level}], absent = level 0. Enabled: [{Key, Value: bool}] for every power-up.
  const levels = p.arr(p.prog, 'PowerUpLevelsUnlocked');
  const enabled = p.arr(p.prog, 'PowerUpEnabled');
  const all = union(p.ids.powerUps, p.kvKeys(levels), p.kvKeys(enabled));
  const maxLevels = p.ids.powerUpMaxLevels ?? {};
  const exp = all.filter(p.isExperimental);
  return h('div', null,
    levels && panel('Power-up levels', 'PowerUpLevelsUnlocked',
      groupedSections(all.filter(p.isRegular), p.ids.powerUpGroups,
        (list, group, onCount) => h('div', null,
          group?.unlock && p.achievements && h('label', { class: 'toggle unlock-toggle', title: `Unlocks: ${p.ids.unlockEffects?.[group.unlock] ?? group.unlock}` },
            h('input', {
              type: 'checkbox', checked: kvGet(p.achievements, group.unlock) === true,
              onchange: (e) => {
                if (e.target.checked) kvSet(p.achievements, group.unlock, true); else kvDelete(p.achievements, group.unlock);
                ctx.changed();
              },
            }),
            h('span', null, 'Unlocked in the shop', h('small', null, group.unlock))),
          kvLevelList(ctx, levels, list, maxLevels, 10, p.ids.hints ?? {}, onCount)), { key: 'powerups' }),
      h('p', { class: 'note' }, 'A level only shows in-game if its shop tier is unlocked ("Unlocked in shop"). Max levels from the in-game shop. Hover a power-up for its effect and base price (the in-game price rises with each purchase).')),
    enabled && panel('Power-ups enabled', 'PowerUpEnabled',
      groupedSections(p.kvKeys(enabled).filter((id) => id && p.isRegular(id)), [{ name: 'On/off in the shop', ids: p.kvKeys(enabled) }],
        (list, _group, onCount) => idChecklist(ctx, {
          ids: list,
          onCount,
          isOn: (id) => kvGet(enabled, id) === true,
          set: (id, on) => kvSet(enabled, id, on), // entry stays, only the switch changes
          hints: p.ids.hints ?? {},
        }), { key: 'powerups-enabled' })),
    experimentalPanel(p, exp,
      levels && kvLevelList(ctx, levels, exp, maxLevels, 5),
      enabled && kvToggleList(enabled, ctx, { keep: p.isExperimental })));
}

/** Card type groups (from the game data: CardConfig -> CardType). */
const CARD_TYPE_GROUPS = [
  ['Attack', 'Attack'], ['Defense', 'Defense'], ['Special', 'Stat boost'], ['Mana', 'Mana'],
  ['Void', 'Pickups'], ['Debuff', 'Debuff'], ['Character', 'Crawler cards'],
];

function cardsView(ctx) {
  const p = progression(ctx);
  const discovered = p && p.arr(p.prog, 'DiscoveredCards');
  if (!discovered) return notInSave('Cards');
  const types = p.ids.apk?.cardTypes ?? {};
  const unlockedBy = p.ids.apk?.unlockedBy ?? {};
  const pack = p.ids.apk?.pack ?? {};
  const ach = p.achievements;
  const all = union(p.ids.apk?.cards ?? [], p.ids.cards, p.ids.characters, discovered, p.slotIds)
    .filter((id) => id && p.isRegular(id));
  // Cards (not Crawler cards) also get their unlock, so they can show up in runs.
  const unlockOf = (id) => (id.startsWith('Card_') ? unlockedBy[id] : undefined);
  const isUnlocked = (id) => !unlockOf(id) || !ach || kvGet(ach, unlockOf(id)) === true;
  const groups = CARD_TYPE_GROUPS.map(([t, name]) => ({
    name, ids: all.filter((id) => (types[id] ?? (id.startsWith('FCC_') ? 'Character' : null)) === t),
  }));
  const unlocks = Object.fromEntries(all.filter(unlockOf).map((id) => [id, unlockOf(id)]));
  return panel('Cards', 'DiscoveredCards',
    groupedSections(all, groups, (list, _group, onCount) => idChecklist(ctx, {
      ids: list,
      onCount,
      isOn: (id) => discovered.includes(id) && isUnlocked(id),
      set: (id, on) => {
        const i = discovered.indexOf(id);
        if (on && i < 0) discovered.push(id);
        if (!on && i >= 0) discovered.splice(i, 1);
        const u = unlockOf(id);
        if (u && ach) { if (on) kvSet(ach, u, true); else kvDelete(ach, u); }
      },
      hints: Object.fromEntries(list.map((id) => [id, [
        unlockOf(id) && (p.ids.unlockHints?.[unlockOf(id)] ?? unlockOf(id)),
        pack[id] === 'Blueberries' && 'Death Parade update',
        unlockOf(id) ? `Sets: discovered + ${unlockOf(id)}` : 'Sets: discovered',
      ].filter(Boolean).join(' · ')])),
      links: linksTo(ctx, list, unlocks, 'achievements', '→ Unlock'),
    }), { key: 'cards', open: false }),
    h('p', { class: 'note' }, 'Checking a card marks it as discovered and sets its unlock (if it has one), so it can show up in runs. Crawler cards only get "discovered" — unlock characters in the Characters tab.'));
}

/** Category of an achievement/unlock ID (by naming convention of the game data). */
function achievementCategory(id) {
  if (/_Character_|^MetricAchievement_Ambrojoe$/.test(id)) return 'Characters';
  if (/_Relic_/.test(id)) return 'Relics';
  if (/ShopTier|PowerUpShop|RelicMuseum|_Inn$|Blacksmith|Jewel|_ChickenShop$|^PowerUpAchievement_/.test(id)) return 'Village & shops';
  if (/^DungeonAchievement_(Unlock_|MoonGolow|GalloBelow|FirstTime|Base_Game|VentoSacro)/.test(id)) return 'Dungeons & progress';
  if (/_Gems_|^MetricAchievement_Boost$/.test(id)) return 'Gems';
  if (/_Arcana_|_(AndAnother|ChainLink|ExperimentalMedicine|ImNotLeaving|JestersHat|MakeAScene|MakeASceme|ManaSython|OverTheTop|SharpMind|ShieldBash|SwollenFist|WildStrength|YourShieldMyLiege)$/.test(id)) return 'Arcanas';
  if (/_Evo_/.test(id)) return 'Evolutions';
  if (/_Event_|Unlocked_DeathParade|Encountered$/.test(id)) return 'Events & enemies';
  return 'Cards & items';
}
const ACHIEVEMENT_CATEGORIES = ['Characters', 'Relics', 'Village & shops', 'Dungeons & progress', 'Cards & items', 'Gems', 'Arcanas', 'Evolutions', 'Events & enemies'];

function achievementsView(ctx) {
  const p = progression(ctx);
  const ach = p && p.achievements;
  if (!ach) return notInSave('Achievements');
  const all = union(p.ids.apk?.achievements ?? [], p.ids.achievements, p.kvKeys(ach)).filter((id) => id && !p.isHidden(id));
  const regular = all.filter(p.isRegular);
  const exp = all.filter(p.isExperimental);
  const groups = ACHIEVEMENT_CATEGORIES.map((name) => ({ name, ids: regular.filter((id) => achievementCategory(id) === name) }));
  const checklist = (list, _group, onCount) => idChecklist(ctx, {
    ids: list,
    onCount,
    isOn: (id) => kvGet(ach, id) === true,
    set: (id, on) => (on ? kvSet(ach, id, true) : kvDelete(ach, id)),
    hints: Object.fromEntries(list.map((id) => [id, [
      p.ids.unlockHints?.[id],
      p.ids.unlockEffects?.[id] && `Unlocks: ${p.ids.unlockEffects[id]}`,
      p.ids.experimental?.[id],
    ].filter(Boolean).join(' · ') || id])),
    links: {
      ...linksTo(ctx, list, invert(p.ids.characterUnlocks), 'characters', '→ Character'),
      ...linksTo(ctx, list, invert(p.ids.relicUnlocks), 'relics', '→ Relic'),
      ...linksTo(ctx, list, invert(Object.fromEntries(Object.entries(p.ids.apk?.unlockedBy ?? {}).filter(([k]) => k.startsWith('Card_')))), 'cards', '→ Card'),
    },
  });
  return h('div', null,
    panel('Achievements & unlocks', 'AchievementsUnlocked',
      h('p', { class: 'note' }, `${regular.length} unlocks of the game. Most content (characters, shop tiers, relics, dungeons, gems, arcanas) is gated by these. Hover an entry for its in-game requirement (from the wiki, where known).`),
      groupedSections(regular, groups, checklist, { key: 'achievements', open: false })),
    experimentalPanel(p, exp, checklist(exp)));
}

function otherView(ctx) {
  const p = progression(ctx);
  if (!p) return notInSave('Other');
  return h('div', null,
    panel('Flags & counters', 'ProgressionSaveData', fieldsEditor(p.prog, ctx, { exclude: ['TotalCoins'] })),
    p.run instanceof Map && panel('Run options', 'RunMetaSaveData', fieldsEditor(p.run, ctx)));
}

// ---------------------------------------------------------------- settings view

function settingsView(ctx) {
  return panel('Settings', null, fieldsEditor(ctx.save.data, ctx),
    h('p', { class: 'note' }, 'Resolution and other nested values can be edited in Raw JSON.'));
}

// ---------------------------------------------------------------- raw JSON view

function rawView(ctx) {
  const textarea = h('textarea', { spellcheck: 'false', 'aria-label': 'Raw save data (JSON)' });
  textarea.value = stringify(ctx.save.data);
  const error = h('span', { class: 'raw-error', role: 'alert' });

  const apply = () => {
    try {
      const data = parse(textarea.value);
      if (!(data instanceof Map)) throw new Error('Top level must be an object { … }');
      ctx.save.root.set('Data', data);
      error.textContent = '';
      ctx.changed();
      ctx.toast('Raw JSON applied');
    } catch (e) {
      error.textContent = e.message;
    }
  };

  return panel('Raw JSON', 'Data block — for experts',
    h('div', { class: 'raw' },
      textarea,
      h('div', { class: 'raw-actions' },
        h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: apply }, 'Apply'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => { textarea.value = stringify(ctx.save.data); error.textContent = ''; } }, 'Revert'),
        error)),
    h('p', { class: 'note' }, 'The checksum is recalculated automatically when you download. Keep numbers in their original style (e.g. 1.0 stays 1.0).'));
}

// ---------------------------------------------------------------- registry

/** Tabs per save kind. */
export function viewsFor(kind) {
  if (kind === 'profile') {
    return [
      { id: 'overview', label: 'Overview', render: profileOverview },
      { id: 'characters', label: 'Characters', render: charactersView },
      { id: 'relics', label: 'Relics', render: relicsView },
      { id: 'powerups', label: 'Power-ups', render: powerUpsView },
      { id: 'cards', label: 'Cards', render: cardsView },
      { id: 'achievements', label: 'Achievements', render: achievementsView },
      { id: 'other', label: 'Other', render: otherView },
      { id: 'raw', label: 'Raw JSON', render: rawView },
    ];
  }
  if (kind === 'settings') {
    return [
      { id: 'settings', label: 'Settings', render: settingsView },
      { id: 'raw', label: 'Raw JSON', render: rawView },
    ];
  }
  return [{ id: 'raw', label: 'Raw JSON', render: rawView }];
}
