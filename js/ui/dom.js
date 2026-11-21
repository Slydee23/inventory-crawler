// Tiny DOM helpers. All text goes through textContent — never innerHTML with save data.

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any> | null} [props] attributes; `on*` functions become listeners
 * @param {...any} children strings, nodes, arrays, null/false (ignored)
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v; // e.g. checked, value, disabled
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** "TotalCoins" -> "Total Coins", "PowerUp_MaxHealth" -> "Max Health". */
export function prettify(id) {
  const KNOWN_PREFIXES = /^(FCC|PowerUp|RelicConfig|GemConfig|Card_[A-Z]_\d+|SimpleAchievement|DungeonAchievement|MetricAchievement|Dungeon|ArcanaConfig|Arcana)_/;
  const name = String(id).replace(KNOWN_PREFIXES, '');
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Format seconds as "1h 23m 45s". */
export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh && `${hh}h`, (hh || mm) && `${mm}m`, `${ss}s`].filter(Boolean).join(' ');
}
