// Editor views. Each view is a function (ctx) => HTMLElement.
// ctx = { save: SaveFile, changed(): void, toast(msg, isError?): void }

import { h, prettify, formatDuration } from './dom.js';
import { JsonNumber, stringify, parse } from '../json-lossless.js';
import { getIn, parseTimeSpan } from '../save-file.js';

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

/** Toggle list for a `[{Key, Value: bool}]` dictionary. */
function kvToggleList(list, ctx) {
  if (!Array.isArray(list) || list.length === 0) {
    return h('p', { class: 'empty' }, 'Nothing here yet.');
  }
  const items = list
    .filter((e) => e instanceof Map && typeof e.get('Value') === 'boolean')
    .map((entry) => h('label', { class: 'toggle' },
      h('input', {
        type: 'checkbox', checked: entry.get('Value'),
        onchange: (e) => { entry.set('Value', e.target.checked); ctx.changed(); },
      }),
      h('span', null, prettify(entry.get('Key')), h('small', null, entry.get('Key')))));
  return h('div', { class: 'toggle-list' }, items);
}

function chips(values) {
  if (!Array.isArray(values) || values.length === 0) return h('p', { class: 'empty' }, 'Nothing here yet.');
  return h('div', { class: 'chips' }, values.map((v) => h('span', { class: 'chip', title: String(v) }, prettify(v))));
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
  const note = 'Only entries already in your save are listed. Unlocking new ones comes once all game IDs are known.';
  return h('div', null,
    panel('Characters', 'CharactersPurchased', kvToggleList(prog.get('CharactersPurchased'), ctx), h('p', { class: 'note' }, note)),
    panel('Power-ups', 'PowerUpEnabled', kvToggleList(prog.get('PowerUpEnabled'), ctx)),
    run instanceof Map && panel('Relics', 'EnabledRelics', kvToggleList(run.get('EnabledRelics'), ctx)),
    panel('Achievements', 'AchievementsUnlocked', kvToggleList(prog.get('AchievementsUnlocked'), ctx)),
    panel('Discovered cards', 'DiscoveredCards', chips(prog.get('DiscoveredCards'))),
    panel('Flags & counters', 'ProgressionSaveData', fieldsEditor(prog, ctx, { exclude: ['TotalCoins'] })),
    run instanceof Map && panel('Run options', 'RunMetaSaveData', fieldsEditor(run, ctx)));
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
