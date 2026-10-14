const $ = (s, el = document) => el.querySelector(s);
const list = $('#list');
const msg = $('#msg');
const tpl = $('#item-tpl');

let items = [];
let nowPlayingId = null;
let dragging = false;

const TYPE_LABEL = {
  youtube: 'YouTube', youtube_playlist: 'YouTube playlist', nasa_image: 'NASA image', nasa_video: 'NASA video', apod: 'APOD', epic: 'EPIC',
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function say(text, kind = 'ok') {
  msg.textContent = text;
  msg.className = kind;
  clearTimeout(say.t);
  say.t = setTimeout(() => { msg.textContent = ''; }, 6000);
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { say(e.message, 'err'); } finally { btn.disabled = false; }
}

// --- Tabs ---------------------------------------------------------------------
document.querySelectorAll('[role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  });
});

// --- Playlist rendering -------------------------------------------------------
function thumbFor(item) {
  return item.payload?.thumb ?? null;
}

function render() {
  if (dragging) return;
  list.replaceChildren(...items.map((item) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = item.id;
    li.classList.toggle('disabled', !item.enabled);
    li.classList.toggle('playing', item.id === nowPlayingId);

    const thumb = $('.thumb', li);
    const t = thumbFor(item);
    if (t) thumb.style.backgroundImage = `url("${t}")`;
    else thumb.textContent = TYPE_LABEL[item.type];

    $('.title', li).textContent = item.title || '(untitled)';
    $('.title', li).title = item.title;
    $('.type', li).textContent = TYPE_LABEL[item.type] ?? item.type;
    $('.live', li).hidden = !item.payload?.isLive;
    $('.now', li).hidden = item.id !== nowPlayingId;
    $('.source', li).textContent = item.source;
    if (item.error) {
      $('.error', li).hidden = false;
      $('.error', li).textContent = `⚠ Skipped last time: ${item.error}`;
    }

    const dur = $('.dur input', li);
    dur.value = item.duration_sec ?? '';
    dur.addEventListener('change', () => patch(item.id, { duration_sec: dur.value || null }));

    const en = $('.enabled', li);
    en.checked = item.enabled;
    en.addEventListener('change', () => patch(item.id, { enabled: en.checked }));

    $('.del', li).addEventListener('click', async () => {
      try { await api(`/api/items/${item.id}`, { method: 'DELETE' }); } catch (e) { say(e.message, 'err'); }
      load();
    });
    return li;
  }));
  $('#count').textContent = items.length ? `(${items.filter((i) => i.enabled).length} of ${items.length} enabled)` : '';
  $('#empty').hidden = items.length > 0;
}

async function load() {
  try {
    items = await api('/api/items');
    render();
  } catch (e) {
    say(`Couldn't load playlist: ${e.message}`, 'err');
  }
}

async function patch(id, body) {
  try { await api(`/api/items/${id}`, { method: 'PATCH', body }); } catch (e) { say(e.message, 'err'); }
  load();
}

Sortable.create(list, {
  handle: '.handle',
  animation: 150,
  onStart: () => { dragging = true; },
  // Fires on every release, even when a touch drag is cancelled, so the list
  // can never stay frozen waiting for a drag that ended.
  onUnchoose: () => { dragging = false; },
  onEnd: async () => {
    dragging = false;
    const ids = [...list.children].map((li) => Number(li.dataset.id));
    items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    try { await api('/api/items/order', { method: 'PUT', body: { ids } }); } catch (e) { say(e.message, 'err'); }
    load();
  },
});

// --- Adding -------------------------------------------------------------------
async function add(body, label) {
  const item = await api('/api/items', { method: 'POST', body });
  say(`Added “${item.title || label}”.`);
  load();
  return item;
}

$('#yt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.submitter;
  busy(btn, async () => {
    await add({ kind: 'youtube', input: $('#yt-input').value, isLive: $('#yt-live').checked });
    $('#yt-input').value = '';
    $('#yt-live').checked = false;
  });
});

document.querySelectorAll('[data-add-kind]').forEach((btn) => {
  btn.addEventListener('click', () => busy(btn, () => add({ kind: btn.dataset.addKind })));
});

async function loadPresets() {
  const presets = await api('/api/presets').catch(() => []);
  $('#presets').replaceChildren(...presets.map((p) => {
    const row = document.createElement('div');
    row.className = 'feed';
    row.innerHTML = '<div><strong></strong> <span class="badge live">LIVE</span><p class="hint"></p></div><button class="btn">Add</button>';
    $('strong', row).textContent = p.title;
    $('.hint', row).textContent = p.note ?? '';
    const btn = $('button', row);
    btn.addEventListener('click', () => busy(btn, () => add({ kind: 'youtube_channel_live', channelId: p.channelId, title: p.title })));
    return row;
  }));
}

$('#lib-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const out = $('#lib-results');
  busy(btn, async () => {
    out.replaceChildren();
    const results = await api(`/api/nasa/search?q=${encodeURIComponent($('#lib-q').value)}&type=${$('#lib-type').value}`);
    if (!results.length) return say('No results.', 'err');
    out.replaceChildren(...results.map((r) => {
      const card = document.createElement('div');
      card.className = 'result';
      card.innerHTML = '<img alt="" loading="lazy"><div class="r-title"></div><div class="r-date"></div><button class="btn">Add</button>';
      $('img', card).src = r.thumb ?? '';
      $('.r-title', card).textContent = r.title;
      card.title = r.description;
      $('.r-date', card).textContent = `${r.mediaType} · ${r.date ?? ''}`;
      const add_ = $('button', card);
      add_.addEventListener('click', () => busy(add_, async () => {
        await add({ kind: 'nasa', nasaId: r.nasaId, title: r.title, thumb: r.thumb });
        add_.textContent = 'Added ✓';
      }));
      return card;
    }));
  });
});

// --- Settings -----------------------------------------------------------------
const sf = $('#settings-form');
async function loadSettings() {
  const s = await api('/api/settings').catch(() => ({}));
  for (const [k, v] of Object.entries(s)) {
    const el = sf.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v === '1';
    else el.value = v;
  }
}
sf.addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    const body = {};
    for (const el of sf.elements) {
      if (!el.name) continue;
      body[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    }
    await api('/api/settings', { method: 'PUT', body });
    say('Settings saved.');
  });
});

// --- Live updates -------------------------------------------------------------
// Changes made elsewhere (another phone, the player reporting errors) arrive as
// server events. Phones drop this connection when the screen sleeps, so also
// reload whenever it reconnects or the page comes back into view.
const events = new EventSource('/api/events');
events.addEventListener('playlist-changed', load);
events.addEventListener('open', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
events.addEventListener('now-playing', (e) => {
  nowPlayingId = JSON.parse(e.data)?.id ?? null;
  render();
});

load();
loadPresets();
loadSettings();
