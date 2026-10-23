// shell UI: control bar + spaces strip. Persona pages are native views main.ts lays over #stage.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
let personas = [];

function strip(space) {
  $('#spaces').innerHTML =
    `<button class="sp" data-space="all" title="All windows (0 or a)"><span class="mini allmini">${personas.map(() => '<i></i>').join('')}</span><span class="sp-l">All</span></button>` +
    personas.map((p, i) => `<button class="sp" data-space="${esc(p.name)}" title="${esc(p.name)} · ${esc(p.device)} (${i + 1})">
      <img class="mini" alt=""><span class="sp-l"><span class="dot"></span>${esc(p.name)} <small>${esc(p.device)}</small></span></button>`).join('') +
    `<span class="keys">← → · 1–9 · 0 = All</span>`;
  mark(space);
}
const mark = space => document.querySelectorAll('.sp').forEach(b => b.classList.toggle('cur', b.dataset.space === space));

nstack.on('init', s => {
  personas = s.personas;
  $('#base').textContent = s.baseUrl;
  strip(s.space);
});
nstack.on('space', space => {
  mark(space);
  document.querySelector('.sp.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
nstack.on('thumb', (name, url) => {
  const img = document.querySelector(`.sp[data-space="${CSS.escape(name)}"] img`);
  if (img) img.src = url;
});

$('#spaces').addEventListener('click', e => {
  const b = e.target.closest('[data-space]');
  if (b) nstack.send('go', b.dataset.space);
});
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || !/^(ArrowLeft|ArrowRight|[0-9]|a)$/.test(e.key)) return;
  e.preventDefault();
  nstack.send('key', e.key);
});
new ResizeObserver(() => {
  const r = $('#stage').getBoundingClientRect();
  nstack.send('stage', { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
}).observe($('#stage'));
nstack.send('ready');
