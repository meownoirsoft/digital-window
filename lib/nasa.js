// NASA sources: Image & Video Library (no key), APOD and EPIC (api.nasa.gov key).
import { parseYouTube } from './youtube.js';

const API_KEY = () => process.env.NASA_API_KEY || 'DEMO_KEY';
const HOUR = 60 * 60 * 1000;
const cache = new Map();

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

// Failures are cached briefly too, so a broken upstream (or a 429 on DEMO_KEY)
// isn't hammered every time the playlist comes round.
const ERROR_TTL = 5 * 60 * 1000;
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.error ? ERROR_TTL : ttl)) {
    if (hit.error) throw hit.error;
    return hit.value;
  }
  try {
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    cache.set(key, { at: Date.now(), error });
    throw error;
  }
}

const https = (u) => u?.replace(/^http:\/\//, 'https://');

// Pick the first href whose name matches one of the suffixes, in preference order.
function pick(hrefs, suffixes) {
  for (const s of suffixes) {
    const hit = hrefs.find((h) => h.toLowerCase().endsWith(s));
    if (hit) return https(hit);
  }
  return null;
}

export async function searchLibrary(q, type = 'image') {
  const url = new URL('https://images-api.nasa.gov/search');
  url.searchParams.set('q', q);
  url.searchParams.set('media_type', type === 'video' ? 'video' : 'image');
  url.searchParams.set('page_size', '40');
  const json = await cached(`search:${url}`, HOUR, () => getJson(url));
  return (json.collection?.items ?? []).map((it) => {
    const d = it.data?.[0] ?? {};
    const thumb = it.links?.find((l) => l.rel === 'preview')?.href;
    return {
      nasaId: d.nasa_id,
      title: d.title,
      description: d.description?.slice(0, 400) ?? '',
      date: d.date_created?.slice(0, 10),
      mediaType: d.media_type,
      thumb: https(thumb),
    };
  }).filter((r) => r.nasaId);
}

// Resolve a library item to a streamable URL. Videos prefer ~large/~medium over
// ~orig because originals can be multi-GB ProRes-ish files that choke a Pi.
export async function resolveAsset(nasaId) {
  const json = await cached(`asset:${nasaId}`, 24 * HOUR, () =>
    getJson(`https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`));
  const hrefs = (json.collection?.items ?? []).map((i) => i.href);
  const video = pick(hrefs, ['~large.mp4', '~medium.mp4', '~mobile.mp4', '~orig.mp4', '.mp4']);
  if (video) {
    return { kind: 'video', url: video, thumb: pick(hrefs, ['~small.jpg', '~thumb.jpg', '.jpg']) };
  }
  const image = pick(hrefs, ['~large.jpg', '~orig.jpg', '~medium.jpg', '.jpg', '.png']);
  if (image) return { kind: 'image', url: image, thumb: pick(hrefs, ['~thumb.jpg', '~small.jpg']) ?? image };
  throw new Error(`No playable media for ${nasaId}`);
}

// Since APOD moved to science.nasa.gov the API has (at times) returned the NASA
// logo instead of the picture, so fall back to reading the APOD page itself.
const APOD_IMG_RE = /https:\/\/assets\.science\.nasa\.gov\/dynamicimage\/assets\/science\/cds\/apod\/apod\/\d{4}\/[^"'?\s]+\.(?:jpe?g|png)/i;

async function scrapeApod() {
  const res = await fetch('https://science.nasa.gov/apod/', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`APOD page returned ${res.status}`);
  const html = await res.text();
  const img = APOD_IMG_RE.exec(html)?.[0];
  if (!img) throw new Error("Couldn't find today's APOD image");
  const title = /<h2 class="display-48[^"]*">([^<]+)<\/h2>/.exec(html)?.[1]?.trim() ?? 'Astronomy Picture of the Day';
  return { kind: 'image', url: `${img}?w=2560&fit=clip`, title, caption: title, date: new Date().toISOString().slice(0, 10) };
}

// Today's Astronomy Picture of the Day, normalized for the player.
export function resolveApod() {
  return cached('apod', HOUR, async () => {
    try {
      const fromApi = await apodFromApi();
      if (!/nasa-logo/i.test(fromApi.url ?? '')) return fromApi;
    } catch { /* fall through */ }
    return scrapeApod();
  });
}

async function apodFromApi() {
  const d = await getJson(`https://api.nasa.gov/planetary/apod?api_key=${API_KEY()}`);
  const base = { title: d.title, caption: d.copyright ? `${d.title} — © ${d.copyright.trim()}` : d.title, date: d.date };
  if (d.media_type === 'image') return { ...base, kind: 'image', url: https(d.hdurl || d.url) };
  if (d.media_type === 'video') {
    const yt = parseYouTube(d.url);
    if (yt) return { ...base, kind: 'youtube', videoId: yt.videoId, start: yt.start };
    if (/\.mp4($|\?)/i.test(d.url)) return { ...base, kind: 'video', url: https(d.url) };
    if (d.thumbnail_url) return { ...base, kind: 'image', url: https(d.thumbnail_url) };
  }
  throw new Error(`APOD media type "${d.media_type}" isn't displayable today`);
}

// Latest day's EPIC full-disc Earth images (epic.gsfc.nasa.gov needs no API key).
export async function resolveEpic() {
  const list = await cached('epic', HOUR, () => getJson('https://epic.gsfc.nasa.gov/api/natural'));
  if (!list.length) throw new Error('EPIC returned no images');
  const images = list.map((e) => {
    const [y, m, d] = e.date.slice(0, 10).split('-');
    return {
      url: `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${e.image}.jpg`,
      caption: `Earth from DSCOVR/EPIC — ${e.date} UTC`,
    };
  });
  return { kind: 'slideshow', title: `EPIC Earth — ${list[0].date.slice(0, 10)}`, images };
}

// YouTube retired the /embed/live_stream?channel= embed, so find the channel's
// current live video ID ourselves: /channel/<id>/live points its canonical link
// at the live watch page when the channel is streaming.
export function resolveChannelLive(channelId) {
  return cached(`live:${channelId}`, 10 * 60 * 1000, async () => {
    const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const videoId = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1];
    // Scheduled-but-not-started streams also report isLive, with isLiveNow:false.
    const live = /"isLive":true/.test(html) && !/"isLiveNow":false/.test(html);
    if (!videoId || !live) throw new Error('Channel is not live right now');
    return { videoId };
  });
}
