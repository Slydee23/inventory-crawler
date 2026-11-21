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
 *           warnOn?: Record<string, string> }} opts
 */
function idChecklist(ctx, { ids, isOn, set, warnOn = {} }) {
  const list = h('div', { class: 'toggle-list' });
  const counter = h('span', { class: 'badge' });
  let filter = '';

  const updateCount = () => { counter.textContent = `${ids.filter(isOn).length} / ${ids.length}`; };
  const render = () => {
    const q = filter.toLowerCase();
    list.replaceChildren(...ids
      .filter((id) => !q || id.toLowerCase().includes(q) || prettify(id).toLowerCase().includes(q))
      .map((id) => h('label', { class: 'toggle', title: warnOn[id] ?? id },
        h('input', {
          type: 'checkbox', checked: isOn(id),
          onchange: (e) => { set(id, e.target.checked); updateCount(); ctx.changed(); },
        }),
        h('span', null, prettify(id), warnOn[id] && ' ⚠', h('small', null, id)))));
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
 * Number inputs for a `[{Key, Value: int}]` dictionary; 0 removes the entry.
 * @param {Record<string, number>} maxById known maximum per ID; others use `fallbackMax` and get a ⚠
 */
function kvLevelList(ctx, list, ids, maxById, fallbackMax) {
  const rows = ids.map((id) => {
    const known = Number.isInteger(maxById[id]);
    const max = known ? maxById[id] : fallbackMax;
    const cur = kvGet(list, id);
    return h('label', { class: 'field' },
      h('span', { class: 'field-label', title: known ? `Max level ${max}` : 'Max level unknown' },
        prettify(id), known ? ` (max ${max})` : ' ⚠', h('small', null, id)),
      h('input', {
        type: 'number', min: '0', max: String(max), step: '1', value: String(cur instanceof JsonNumber ? cur.value : 0),
        onchange: (e) => {
          const n = Number(e.target.value);
          if (!Number.isInteger(n) || n < 0 || n > max) {
            ctx.toast(`${prettify(id)}: enter a whole number from 0 to ${max}`, true);
            const now = kvGet(list, id);
            e.target.value = String(now instanceof JsonNumber ? now.value : 0);
            return;
          }
          if (n === 0) kvDelete(list, id);
          else kvSet(list, id, JsonNumber.int(n));
          ctx.changed();
        },
      }));
  });
  return h('div', { class: 'fields' }, rows);
}

function stat(label, value) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value ?? '—'));
}

// ---------------------------------------------------------------- profile views

function coinsEditor(ctx) {
  const d = ctx.save.data;
  // Coins are stored twice; keep both in sync.
  const paths = [['ProfileSaveData', 'TotalCoins'], ['ProgressionSaveData', 'TotalCoins']]
    .filter((p) => getIn(d, ...p) instanceof JsonNumber);
  if (!paths.length) return null;
  const current = getIn(d, ...paths[0]).value;

  const input = h('input', { type: 'number', min: '0', max: String(INT32_MAX), step: '1', value: String(current) });
  const apply = (n) => {
    if (!Number.isInteger(n) || n < 0 || n > INT32_MAX) {
      ctx.toast(`Coins must be a whole number between 0 and ${INT32_MAX.toLocaleString('en')}`, true);
      input.value = String(getIn(d, ...paths[0]).value);
      return;
    }
    for (const p of paths) getIn(d, ...p.slice(0, -1)).set(p[p.length - 1], JsonNumber.int(n));
    input.value = String(n);
    ctx.changed();
  };
  input.addEventListener('change', () => apply(Number(input.value)));

  return panel('Coins', null,
    h('div', { class: 'coins' },
      h('span', { class: 'coin-icon', 'aria-hidden': 'true' }),
      input,
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(Number(input.value) + 10000) }, '+10k'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(Number(input.value) + 100000) }, '+100k'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => apply(999999) }, '999,999')),
    h('p', { class: 'note' }, 'Updates both coin counters stored in the save.'));
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
    panel('Profile', null, h('div', { class: 'stats' },
      stat('Profile', d.get('ProfileId')),
      stat('Save system', d.get('saveSystemVersion')),
      stat('Play time', playtime),
      stat('Last saved', saved),
      stat('Characters', count(prog?.get('CharactersPurchased'))),
      stat('Cards discovered', count(prog?.get('DiscoveredCards'))),
      stat('Achievements', count(prog?.get('AchievementsUnlocked'))),
      stat('Dungeon', prettify(getIn(d, 'RunMetaSaveData', 'SelectedDungeonID') ?? '—')))),
    coinsEditor(ctx));
}

function progressionView(ctx) {
  const prog = ctx.save.data.get('ProgressionSaveData');
  const run = ctx.save.data.get('RunMetaSaveData');
  if (!(prog instanceof Map)) return panel('Progression', null, h('p', { class: 'empty' }, 'Not found in this save.'));
  const ids = ctx.ids;
  const arr = (map, key) => (map instanceof Map && Array.isArray(map.get(key)) ? map.get(key) : null);
  const kvKeys = (list) => (list ?? []).map((e) => e instanceof Map && e.get('Key'));
  const slotIds = kvKeys(arr(prog, 'CardGemSlots'));

  // Characters: present with Value true = purchased. Removing deletes the entry (as in a fresh save).
  const chars = arr(prog, 'CharactersPurchased');
  const charIds = union(ids.characters, kvKeys(chars), slotIds.filter((k) => k?.startsWith('FCC_')));
  const charPanel = chars && panel('Characters', 'CharactersPurchased',
    idChecklist(ctx, {
      ids: charIds,
      isOn: (id) => kvGet(chars, id) === true,
      set: (id, on) => (on ? kvSet(chars, id, true) : kvDelete(chars, id)),
      warnOn: { FCC_MissingNo: 'Secret/glitch character — unlock at your own risk (not included in "All")' },
    }),
    h('p', { class: 'note' }, 'Keep at least one character. "All" skips entries marked ⚠.'));

  // Experimental IDs (e.g. leftovers that don't exist in the game UI) live in their own section.
  const experimental = ids.experimental ?? {};
  const isExperimental = (id) => Object.hasOwn(experimental, id);
  // Hidden IDs (dev leftovers without effect) are never shown; they still round-trip untouched.
  const isHidden = (id) => Object.hasOwn(ids.hidden ?? {}, id);
  const notExperimental = (id) => !isExperimental(id) && !isHidden(id);

  // Power-up levels: [{Key, Value: level}], absent = level 0.
  const levels = arr(prog, 'PowerUpLevelsUnlocked');
  const enabled = arr(prog, 'PowerUpEnabled');
  const allPowerUps = union(ids.powerUps, kvKeys(levels), kvKeys(enabled));
  const levelPanel = levels && panel('Power-up levels', 'PowerUpLevelsUnlocked',
    kvLevelList(ctx, levels, allPowerUps.filter(notExperimental), ids.powerUpMaxLevels ?? {}, 10),
    h('p', { class: 'note' }, 'Max levels are taken from the in-game shop. ⚠ = maximum not known yet, stay within what the shop shows.'));

  const expPowerUps = allPowerUps.filter((id) => isExperimental(id) && !isHidden(id));
  const experimentalPanel = expPowerUps.length > 0 && h('details', { class: 'panel experimental' },
    h('summary', { class: 'panel-title' }, 'Experimental', h('small', null, 'unused or unconfirmed game data')),
    h('p', { class: 'warn-box' },
      '⚠ These entries exist in the save but have no counterpart in the game UI. Changing them may do nothing — or break your save. Keep a backup.'),
    expPowerUps.map((id) => h('p', { class: 'note' }, h('code', null, id), ` — ${experimental[id]}`)),
    levels && kvLevelList(ctx, levels, expPowerUps, ids.powerUpMaxLevels ?? {}, 5),
    enabled && kvToggleList(enabled, ctx, { keep: isExperimental }));

  // Relics: present = owned, Value = enabled. Unchecking keeps the relic but disables it.
  const relics = arr(run, 'EnabledRelics');
  const relicPanel = relics && panel('Relics', 'EnabledRelics',
    idChecklist(ctx, {
      ids: union(ids.relics, kvKeys(relics)),
      isOn: (id) => kvGet(relics, id) === true,
      set: (id, on) => (on || kvGet(relics, id) !== undefined) && kvSet(relics, id, on),
    }),
    h('p', { class: 'note' }, 'Only relics seen in real saves are listed so far.'));

  // Discovered cards: plain string list.
  const discovered = arr(prog, 'DiscoveredCards');
  const cardPanel = discovered && panel('Discovered cards', 'DiscoveredCards',
    idChecklist(ctx, {
      ids: union(ids.cards, ids.characters, discovered, slotIds),
      isOn: (id) => discovered.includes(id),
      set: (id, on) => {
        const i = discovered.indexOf(id);
        if (on && i < 0) discovered.push(id);
        if (!on && i >= 0) discovered.splice(i, 1);
      },
      warnOn: { FCC_MissingNo: 'Secret/glitch character' },
    }));

  return h('div', null,
    charPanel,
    levelPanel,
    panel('Power-ups enabled', 'PowerUpEnabled', kvToggleList(enabled, ctx, { keep: notExperimental })),
    relicPanel,
    cardPanel,
    panel('Achievements', 'AchievementsUnlocked', kvToggleList(prog.get('AchievementsUnlocked'), ctx),
      h('p', { class: 'note' }, 'Only achievements already in your save are listed.')),
    panel('Flags & counters', 'ProgressionSaveData', fieldsEditor(prog, ctx, { exclude: ['TotalCoins'] })),
    run instanceof Map && panel('Run options', 'RunMetaSaveData', fieldsEditor(run, ctx)),
    experimentalPanel);
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
      { id: 'progression', label: 'Progression', render: progressionView },
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
