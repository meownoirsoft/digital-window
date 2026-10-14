import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTube, parseTime, parsePlaylist } from '../lib/youtube.js';

const ID = 'dQw4w9WgXcQ';

test('bare id', () => {
  assert.deepEqual(parseYouTube(ID), { videoId: ID, start: 0, isLive: false });
  assert.deepEqual(parseYouTube(`  ${ID}\n`), { videoId: ID, start: 0, isLive: false });
});

test('url variants', () => {
  const cases = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=abc`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=xyz`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ];
  for (const c of cases) assert.equal(parseYouTube(c)?.videoId, ID, c);
});

test('live urls are flagged', () => {
  assert.deepEqual(parseYouTube(`https://www.youtube.com/live/${ID}?si=a`), { videoId: ID, start: 0, isLive: true });
});

test('start times', () => {
  assert.equal(parseYouTube(`https://youtu.be/${ID}?t=42`).start, 42);
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1m30s`).start, 90);
  assert.equal(parseYouTube(`https://www.youtube.com/embed/${ID}?start=15`).start, 15);
  assert.equal(parseTime('1h2m3s'), 3723);
  assert.equal(parseTime('garbage'), 0);
});

test('rejects junk', () => {
  for (const c of ['', null, 'hello', 'https://vimeo.com/123', `https://evil.com/watch?v=${ID}`, 'https://youtu.be/short', 'https://www.youtube.com/@channel']) {
    assert.equal(parseYouTube(c), null, String(c));
  }
});

test('playlists', () => {
  const PL = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
  assert.deepEqual(parsePlaylist(`https://www.youtube.com/playlist?list=${PL}`), { listId: PL, isMix: false });
  assert.deepEqual(parsePlaylist(`youtube.com/playlist?list=${PL}&si=abc`), { listId: PL, isMix: false });
  assert.deepEqual(parsePlaylist(`https://m.youtube.com/playlist?list=${PL}`), { listId: PL, isMix: false });
  assert.deepEqual(parsePlaylist(`https://www.youtube.com/embed/videoseries?list=${PL}`), { listId: PL, isMix: false });
  assert.deepEqual(parsePlaylist(PL), { listId: PL, isMix: false });
  assert.equal(parsePlaylist('https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ').isMix, true);
  // A video played from a playlist stays a single video.
  assert.equal(parsePlaylist(`https://www.youtube.com/watch?v=${ID}&list=${PL}`), null);
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${ID}&list=${PL}`).videoId, ID);
  for (const c of ['', ID, 'https://www.youtube.com/playlist', 'https://evil.com/playlist?list=' + PL, 'https://www.youtube.com/playlist?list=nope']) {
    assert.equal(parsePlaylist(c), null, c);
  }
});
