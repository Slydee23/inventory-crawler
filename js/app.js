// App controller: file loading, tabs, export.

import { SaveFile } from './save-file.js';
import { h, setDisplayNames } from './ui/dom.js';
import { viewsFor } from './ui/views.js';

const $ = (id) => document.getElementById(id);

const state = {
  /** @type {SaveFile | null} */
  save: null,
  dirty: false,
  tab: null,
  /** Known game IDs (data/ids.json); empty lists if it fails to load. */
  ids: {},
};

const idsReady = fetch('data/ids.json')
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((ids) => { state.ids = ids; setDisplayNames(ids.displayNames); });

// ---------------------------------------------------------------- toast

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
}

// ---------------------------------------------------------------- loading

async function openFile(file) {
  if (!file) return;
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  try {
    const text = await file.text();
    await idsReady;
    state.save = await SaveFile.load(text, file.name);
    state.dirty = false;
    state.tab = null;
    showEditor();
    if (!state.save.checksumValid) {
      toast('Warning: the checksum of this file is not valid. It may be damaged or already edited.', true);
    }
  } catch (e) {
    console.error(e);
    const notASave = e instanceof SyntaxError || /Not a Vampire Crawlers save/.test(e.message);
    toast(notASave
      ? `"${file.name}" is not a Vampire Crawlers save. Pick SaveProfile0.save or SettingsData.save.`
      : `Could not read file: ${e.message}`, true);
  }
}

function showEditor() {
  const save = state.save;
  $('start').hidden = true;
  $('editor').hidden = false;
  $('file-name').textContent = save.fileName || 'save';
  $('file-kind').textContent = { profile: 'Profile', settings: 'Settings', unknown: 'Unknown type' }[save.kind];

  const cs = $('checksum-badge');
  cs.textContent = save.checksumValid ? '✔ Checksum OK' : '✖ Checksum invalid';
  cs.className = `badge ${save.checksumValid ? 'badge-ok' : 'badge-bad'}`;

  renderTabs();
  updateDirty();
}

function closeFile() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  state.save = null;
  state.dirty = false;
  $('editor').hidden = true;
  $('start').hidden = false;
  $('file-input').value = '';
}

// ---------------------------------------------------------------- tabs & views

function renderTabs() {
  const views = viewsFor(state.save.kind);
  if (!views.some((v) => v.id === state.tab)) state.tab = views[0].id;
  const nav = $('tabs');
  nav.replaceChildren(...views.map((v) => h('button', {
    class: 'tab', type: 'button', role: 'tab',
    'aria-selected': String(v.id === state.tab),
    onclick: () => { state.tab = v.id; renderTabs(); },
  }, v.label)));
  const view = views.find((v) => v.id === state.tab);
  $('view').replaceChildren(view.render({ save: state.save, ids: state.ids, changed, toast }));
}

function changed() {
  state.dirty = true;
  updateDirty();
}

function updateDirty() {
  $('dirty-badge').hidden = !state.dirty;
}

// ---------------------------------------------------------------- export

function download(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadEdited() {
  try {
    const text = await state.save.serialize();
    download(text, state.save.fileName || 'SaveProfile0.save');
    state.dirty = false;
    updateDirty();
    toast('Saved! Copy the file back into your game folder.');
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, true);
  }
}

function downloadBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  download(state.save.originalText, `${state.save.fileName || 'save'}.backup-${stamp}`);
}

// ---------------------------------------------------------------- wiring

const input = $('file-input');
const drop = $('dropzone');

input.addEventListener('change', () => openFile(input.files[0]));
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
});
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, () => drop.classList.remove('drag'));
}
drop.addEventListener('drop', (e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); });
// Allow dropping anywhere while the editor is open.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  if (!drop.contains(e.target)) { e.preventDefault(); openFile(e.dataTransfer?.files[0]); }
});

$('close-file').addEventListener('click', closeFile);
$('home-link').addEventListener('click', (e) => {
  e.preventDefault(); // no reload: closeFile() asks before discarding unsaved changes
  if (state.save) closeFile();
  window.scrollTo({ top: 0 });
});
$('download').addEventListener('click', downloadEdited);
$('download-backup').addEventListener('click', downloadBackup);

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});
