// shell UI: control bar, spaces strip, terminal pane, add dialog, yml drawer. Persona pages are native views
// main.ts lays over #stage; every action goes to main, which echoes it as its CLI line in the terminal.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
let personas = [], space = 'all', syncPrefs = { query: true, leaderOnlyCurrent: false, follow: {} };
const thumbs = {}; // last live preview per persona, kept across strip re-renders
const urls = {}; // each persona's current path, for its frame's address bar

function chips() {
  $('#chips').innerHTML = personas.map(p => `<button class="chip ${p.out ? 'out' : ''}" data-chip="${esc(p.name)}"
    title="${p.out ? 'logged out · click to log in' : 'session saved · click to reset'}"><span class="dot"></span>${esc(p.name)}</button>`).join('');
}

function strip() {
  const k = 46 / Math.max(...personas.map(p => p.height));
  $('#spaces').innerHTML =
    `<button class="sp" data-space="all" title="All windows (0 or a)"><span class="mini allmini">${personas.map(p =>
      `<i style="width:${Math.round(p.width * k)}px;height:${Math.round(p.height * k)}px"></i>`).join('')}</span><span class="sp-l">All</span></button>` +
    personas.map((p, i) => `<button class="sp ${p.out ? 'out' : ''}" data-space="${esc(p.name)}" draggable="true" title="${esc(p.name)} · ${esc(p.device)} ${p.width}×${p.height} (${i + 1})">
      <img class="mini" alt="" draggable="false" ${thumbs[p.name] ? `src="${thumbs[p.name]}"` : ''}><span class="sp-l"><span class="dot"></span>${esc(p.name)} <small>${esc(p.device)}</small></span></button>`).join('') +
    `<button class="sp add" id="b-add" title="Add space"><span class="mini">+</span><span class="sp-l"><small>Add space</small></span></button>
     <span class="keys">← → · 1–9 · 0 = All</span>`;
  document.querySelectorAll('.sp[data-space]').forEach(b => b.classList.toggle('cur', b.dataset.space === space));
  document.querySelector('.sp.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function log(lines) {
  const L = $('#log');
  for (const [c, t] of lines) {
    const d = document.createElement('div');
    d.className = 'l-' + (c || 'x');
    d.textContent = t;
    L.appendChild(d);
  }
  L.scrollTop = L.scrollHeight;
}

// same highlighting as the mock's drawer
function renderYml(text) {
  const h = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  $('#yml-pre').innerHTML = text.split('\n').map(line => {
    const m = line.match(/(^|\s)#.*$/), i = m ? m.index + m[1].length : line.length;
    const [code, cmt] = [line.slice(0, i), line.slice(i)];
    return h(code).replace(/^(\s*)([\w"\[\]=.\-]+):/, '$1<span class="y-k">$2</span>:').replace(/("[^"]*")(\s*)$/, '<span class="y-s">$1</span>$2')
      + (cmt ? `<span class="y-c">${h(cmt)}</span>` : '');
  }).join('\n');
}

// overlays: native views would paint over them, so main hides the views while one is open
let lastFocus = null;
const isOpen = () => document.querySelector('.scrim.open, .drawer.open');
function show(sel) {
  lastFocus = document.activeElement;
  $(sel).classList.add('open');
  nstack.send('covered', true);
}
function closeAll() {
  if (!isOpen()) return;
  document.querySelectorAll('.scrim.open, .drawer.open').forEach(el => el.classList.remove('open'));
  nstack.send('covered', false);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function openAdd() {
  $('#ad-name').value = '';
  $('#ad-name').setCustomValidity('');
  $('#ad-dev').value = 'iphone-15';
  $('#ad-path').value = '/';
  $('#ad-in').checked = true;
  show('#addsp');
  setTimeout(() => $('#ad-name').focus(), 30);
}

function openPrefs() {
  $('#spf-query').checked = syncPrefs.query;
  $('#spf-leader').checked = syncPrefs.leaderOnlyCurrent;
  $('#spf-follow').innerHTML = personas.map(p => `<label class="ck"><input type="checkbox" data-follow="${esc(p.name)}" ${syncPrefs.follow[p.name] === false ? '' : 'checked'}> ${esc(p.name)}</label>`).join('');
  show('#syncprefs');
  setTimeout(() => $('#spf-query').focus(), 30);
}

nstack.on('init', s => {
  $('#ver').textContent = s.version;
  $('#base').textContent = s.baseUrl;
  $('#dir').textContent = s.dir;
  document.querySelectorAll('.yml-name').forEach(el => { el.textContent = s.file; });
  $('#b-yml').textContent = s.file;
  $('#ad-dev').innerHTML = s.presets.map(([k, w, h]) => `<option value="${esc(k)}">${esc(k)} · ${w}×${h}</option>`).join('');
});
nstack.on('state', s => {
  personas = s.personas;
  space = s.space;
  syncPrefs = s.syncPrefs;
  chips();
  strip();
  document.querySelectorAll('[data-tile]').forEach(b => b.classList.toggle('on', b.dataset.tile === s.tile));
  $('.seg').classList.toggle('off', space !== 'all');
  $('#b-sync').classList.toggle('on', s.sync);
  $('#b-sync').setAttribute('aria-pressed', s.sync);
  $('#b-sync').textContent = s.sync ? 'Sync on' : 'Sync';
});
nstack.on('log', log);
nstack.on('yml', renderYml);
nstack.on('thumb', (name, url) => {
  thumbs[name] = url;
  const img = document.querySelector(`.sp[data-space="${CSS.escape(name)}"] img`);
  if (img) img.src = url;
});
// saved shots, or the logged-out note in place of one
nstack.on('shots', shots => {
  $('#b-shot').disabled = false;
  if (!shots) return;
  $('#shotgrid').innerHTML = shots.map(s => s.src
    ? `<figure><img src="${s.src}" alt="${esc(s.name)} screenshot"><figcaption>${esc(s.file)}<span>${s.width}×${s.height}</span></figcaption></figure>`
    : `<figure class="skip"><figcaption>${esc(s.line)}</figcaption></figure>`).join('');
  show('#shots');
  setTimeout(() => $('#shots [data-close]').focus(), 30);
});

// the frame (title bar = persona · device · real size · address bar) around each visible persona; logged-out ones get the placeholder
nstack.on('frames', frames => {
  for (const f of frames) urls[f.name] = f.url;
  $('#frames').innerHTML = frames.filter(f => f.shown).map(f => `<div class="frame" style="left:${f.rect.x}px;top:${f.rect.y}px;width:${f.rect.width}px;height:${f.rect.height}px">
    <div class="bar" title="${esc(f.name)} · ${esc(f.device)} · ${esc(f.size)}"><span class="lights"><i></i><i></i><i></i></span><span><b>${esc(f.name)}</b> · ${esc(f.device)} · ${esc(f.size)}</span>
      <input class="url" data-url="${esc(f.name)}" value="${esc(f.url)}" spellcheck="false" autocomplete="off" aria-label="${esc(f.name)} address"></div>
    ${f.out ? `<div class="lo"><b>⊘</b>Logged out<div>run <code>nstack login ${esc(f.name)}</code></div><button class="lb" data-login="${esc(f.name)}">Log in now</button></div>` : ''}</div>`).join('');
});

// a persona navigated; leave the address bar alone while it is being edited
nstack.on('url', ({ name, path }) => {
  urls[name] = path;
  const i = document.querySelector(`input[data-url="${CSS.escape(name)}"]`);
  if (i && i !== document.activeElement) i.value = path;
});
$('#frames').addEventListener('keydown', e => {
  const i = e.target.closest('input[data-url]');
  if (!i || (e.key !== 'Enter' && e.key !== 'Escape')) return;
  if (e.key === 'Enter') nstack.send('goto', { name: i.dataset.url, path: i.value });
  else i.value = urls[i.dataset.url] ?? '';
  i.blur();
});
$('#frames').addEventListener('click', e => {
  const l = e.target.closest('[data-login]');
  if (l) nstack.send('login', l.dataset.login);
});
$('#chips').addEventListener('click', e => {
  const c = e.target.closest('[data-chip]');
  if (c) nstack.send('chip', c.dataset.chip);
});
$('#spaces').addEventListener('click', e => {
  if (e.target.closest('#b-add')) return openAdd();
  const b = e.target.closest('[data-space]');
  if (b) nstack.send('go', b.dataset.space);
});
// drag a persona tile onto another to reorder the strip (All and Add space stay put)
let dragging = null;
const clearDrop = () => document.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
$('#spaces').addEventListener('dragstart', e => {
  dragging = e.target.closest?.('.sp[draggable="true"]')?.dataset.space ?? null;
  if (dragging) e.dataTransfer.effectAllowed = 'move';
});
$('#spaces').addEventListener('dragover', e => {
  const b = e.target.closest?.('.sp[draggable="true"]');
  clearDrop();
  if (!dragging || !b || b.dataset.space === dragging) return;
  e.preventDefault();
  const r = b.getBoundingClientRect();
  b.classList.add(e.clientX < r.x + r.width / 2 ? 'drop-before' : 'drop-after');
});
$('#spaces').addEventListener('drop', e => {
  const b = e.target.closest?.('.drop-before, .drop-after');
  if (!dragging || !b) return;
  e.preventDefault();
  const order = personas.map(p => p.name).filter(n => n !== dragging);
  order.splice(order.indexOf(b.dataset.space) + (b.classList.contains('drop-after') ? 1 : 0), 0, dragging);
  clearDrop();
  nstack.send('reorder', order);
});
$('#spaces').addEventListener('dragend', () => { dragging = null; clearDrop(); });
$('#ad-name').addEventListener('input', e => e.target.setCustomValidity(['all', ...personas.map(p => p.name)].includes(e.target.value.trim()) ? 'that space already exists' : ''));
$('#ad-form').addEventListener('submit', e => {
  e.preventDefault();
  const add = { name: $('#ad-name').value.trim(), device: $('#ad-dev').value, start: $('#ad-path').value.trim(), login: $('#ad-in').checked };
  closeAll();
  nstack.send('add', add);
});
$('#spf-form').addEventListener('submit', e => {
  e.preventDefault();
  const follow = Object.fromEntries([...document.querySelectorAll('[data-follow]')].map(c => [c.dataset.follow, c.checked]));
  closeAll();
  nstack.send('syncprefs', { query: $('#spf-query').checked, leaderOnlyCurrent: $('#spf-leader').checked, follow });
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeAll));
document.querySelectorAll('.scrim').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeAll(); }));
$('#b-up').onclick = () => nstack.send('up');
$('#b-login').onclick = () => nstack.send('login');
$('#b-shot').onclick = () => { $('#b-shot').disabled = true; nstack.send('shot'); };
$('#b-sync').onclick = () => nstack.send('sync');
$('#b-syncprefs').onclick = openPrefs;
$('#b-yml').onclick = () => { nstack.send('yml'); show('#yml'); };
document.querySelectorAll('[data-tile]').forEach(b => b.onclick = () => nstack.send('tile', b.dataset.tile));
$('#b-term').onclick = () => $('#term').classList.toggle('closed'); // #stage shrinks or grows, the observer below re-lays out

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') return closeAll();
  if (isOpen() || e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey || !/^(ArrowLeft|ArrowRight|[0-9]|a)$/.test(e.key)) return;
  e.preventDefault();
  nstack.send('key', e.key);
});
new ResizeObserver(() => {
  const r = $('#stage').getBoundingClientRect();
  nstack.send('stage', { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
}).observe($('#stage'));
nstack.send('ready');
