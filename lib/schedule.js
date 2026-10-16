// Screen schedule: which hours the screen is on, per day of the week, plus a
// manual "on/off now" override that lasts until the next scheduled change.
// All times are in the server's local time zone.

// days[0] is Sunday, matching Date#getDay().
export const DEFAULT_SCHEDULE = {
  enabled: false,
  days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ enabled: d >= 1 && d <= 5, on: '08:00', off: '18:00' })),
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });

export function normalizeSchedule(input) {
  if (!input || !Array.isArray(input.days) || input.days.length !== 7) throw bad('The schedule needs an entry for each of the 7 days.');
  return {
    enabled: !!input.enabled,
    days: input.days.map((d, i) => {
      const on = String(d?.on ?? ''), off = String(d?.off ?? '');
      if (!HHMM.test(on) || !HHMM.test(off)) throw bad('Times should look like 08:30 or 17:45.');
      if (d.enabled && on === off) throw bad(`${DAY_NAMES[i]}: the on and off times are the same.`);
      return { enabled: !!d.enabled, on, off };
    }),
  };
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function at(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime();
}

// Every on/off moment from two days before `now` to eight days after, sorted.
// An off time earlier than the on time means "off the next morning".
function transitions(schedule, now) {
  const out = [];
  const today = new Date(now);
  for (let k = -2; k <= 8; k++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
    const day = schedule.days[d.getDay()];
    if (!day?.enabled) continue;
    const on = at(d, day.on);
    let off = at(d, day.off);
    if (off <= on) off = at(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), day.off);
    out.push({ at: on, on: true }, { at: off, on: false });
  }
  return out.sort((a, b) => a.at - b.at);
}

// What the schedule alone says at `now`, and when that next changes.
function scheduled(schedule, now) {
  if (!schedule.enabled) return { on: true, next: null };
  const list = transitions(schedule, now);
  const on = list.filter((t) => t.at <= now).at(-1)?.on ?? false;
  const next = list.find((t) => t.at > now && t.on !== on) ?? null;
  return { on, next };
}

// The screen's state: { on, reason: 'always' | 'schedule' | 'manual', next: { at, on } | null }.
// An override is { on, until } (until = ms timestamp, or null for "until changed").
export function screenState(schedule, override, now = Date.now()) {
  const s = scheduled(schedule, now);
  if (override && (override.until == null || now < override.until) && override.on !== s.on) {
    // The override lasts until the schedule catches up with it, so the next
    // real change is the one after that.
    return { on: override.on, reason: 'manual', next: override.until == null ? null : scheduled(schedule, override.until).next };
  }
  return { on: s.on, reason: schedule.enabled ? 'schedule' : 'always', next: s.next };
}

// The override to store when someone switches the screen on or off by hand:
// it holds until the schedule next changes state, or null if it isn't needed.
export function makeOverride(schedule, on, now = Date.now()) {
  const s = scheduled(schedule, now);
  if (on === s.on) return null;
  return { on, until: s.next?.at ?? null };
}

// "17:30", "tomorrow 08:00" or "Mon 08:00", in the server's time zone (which
// may differ from the phone looking at the admin page).
export function timeLabel(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  if (days === 0) return hhmm;
  if (days === 1) return `tomorrow ${hhmm}`;
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${hhmm}`;
}
