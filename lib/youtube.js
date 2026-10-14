// Parse anything a user might paste (bare ID, watch/shorts/live/embed URLs,
// youtu.be links) into { videoId, start, isLive }.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be',
]);

// "90", "90s", "1m30s", "1h2m3s" -> seconds
export function parseTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d+(?::\d{1,2}){1,2}$/.test(t)) return t.split(':').reduce((sum, n) => sum * 60 + Number(n), 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

export function parseYouTube(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return { videoId: raw, start: 0, isLive: false };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  let videoId = null;
  let isLive = false;

  if (host.endsWith('youtu.be')) {
    videoId = parts[0];
  } else if (parts[0] === 'watch') {
    videoId = url.searchParams.get('v');
  } else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) {
    videoId = parts[1];
    isLive = parts[0] === 'live';
  } else if (url.searchParams.get('v')) {
    videoId = url.searchParams.get('v');
  }

  if (!videoId || !ID_RE.test(videoId)) return null;
  const start = parseTime(url.searchParams.get('t') || url.searchParams.get('start'));
  return { videoId, start, isLive };
}

// Playlist IDs: PL (user playlists), UU (a channel's uploads), OL (albums),
// FL/LL (favourites/likes). RD... are auto-generated "Mix" radios, which are
// endless and personalised, so they can't be embedded as a playlist.
const LIST_RE = /^(?:PL|UU|OL|FL|LL|RD)[\w-]{10,}$/;

// A playlist link -> { listId, isMix }. A "watch?v=…&list=…" link is a video
// that happens to be playing from a playlist, so it's left to parseYouTube.
export function parsePlaylist(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let listId = null;
  if (LIST_RE.test(raw)) {
    listId = raw;
  } else {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;
    const list = url.searchParams.get('list');
    const parts = url.pathname.split('/').filter(Boolean);
    const isPlaylistPage = parts[0] === 'playlist' || (parts[0] === 'embed' && parts[1] === 'videoseries');
    if (!list || !isPlaylistPage) return null;
    listId = list;
  }
  if (!LIST_RE.test(listId)) return null;
  return { listId, isMix: listId.startsWith('RD') };
}
