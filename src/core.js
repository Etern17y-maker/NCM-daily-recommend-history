/* Daily Recommendation History — local metadata only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BNCMDailyHistoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PREFIX = "bncm.daily-history.v1.";
  const DAYS = 30;
  const SETTINGS_KEY = "bncm.daily-history.settings.v1";
  function validDays(value) { return Number.isSafeInteger(value) && value > 0; }
  function readSettings(storage) {
    const defaults = { autoClear: true, days: DAYS };
    try {
      const value = JSON.parse(storage.getItem(SETTINGS_KEY));
      if (!value || typeof value.autoClear !== "boolean" || !validDays(value.days)) return defaults;
      return { autoClear: value.autoClear, days: value.days };
    } catch (_) { return defaults; }
  }
  function writeSettings(storage, value) {
    if (typeof value.autoClear !== "boolean" || !validDays(value.days)) throw new Error("请输入正整数天数");
    storage.setItem(SETTINGS_KEY, JSON.stringify({ autoClear: value.autoClear, days: value.days }));
  }
  const pad = n => String(n).padStart(2, "0");
  function dateKey(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // The client says daily recommendations refresh at 06:00 local time.
  function recommendationDate(now) {
    const d = new Date(now);
    d.setHours(d.getHours() - 6);
    return dateKey(d);
  }
  function dayNumber(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return NaN;
    const [y, m, d] = key.split("-").map(Number);
    const value = Date.UTC(y, m - 1, d);
    return new Date(value).toISOString().slice(0, 10) === key ? value / 86400000 : NaN;
  }
  function validUid(uid) { return /^[1-9]\d*$/.test(String(uid || "")); }
  function cloneTracks(tracks) {
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 500) return [];
    const seen = new Set();
    const result = [];
    for (const track of tracks) {
      if (!track || !/^[1-9]\d*$/.test(String(track.id || "")) || seen.has(String(track.id))) continue;
      const copy = JSON.parse(JSON.stringify(track, (key, value) => {
        // Playback always goes through the client; do not persist audio URLs or credentials.
        if (/^(url|playUrl|downloadUrl|cookie|token|authorization)$/i.test(key)) return undefined;
        return typeof value === "function" ? undefined : value;
      }));
      if (!copy.name || typeof copy.name !== "string") continue;
      seen.add(String(copy.id));
      result.push(copy);
    }
    return result;
  }
  function prune(days, today, limit = DAYS) {
    const current = dayNumber(today);
    if (!Number.isFinite(current)) throw new Error("无效的推荐日期");
    const unique = new Map();
    for (const item of Array.isArray(days) ? days : []) {
      const distance = current - dayNumber(item && item.date);
      if (!Number.isFinite(distance) || distance < 0 || distance >= limit) continue;
      const tracks = cloneTracks(item.tracks);
      if (!tracks.length) continue;
      unique.set(item.date, Object.assign({}, item, { tracks }));
    }
    return Array.from(unique.values()).sort((a, b) => b.date.localeCompare(a.date));
  }
  function mergeDates(server, local) {
    return Array.from(new Set([...(Array.isArray(server) ? server : []), ...local]
      .filter(date => Number.isFinite(dayNumber(date))))).sort().reverse();
  }
  function createArchive(storage, clock, onError) {
    clock = clock || (() => new Date());
    onError = onError || (() => {});
    const retentionLimit = () => {
      const settings = readSettings(storage);
      return settings.autoClear ? settings.days : Infinity;
    };
    function eligible(date, today = recommendationDate(clock())) {
      const age = dayNumber(today) - dayNumber(date);
      return Number.isFinite(age) && age >= 0 && age < retentionLimit();
    }
    function read(uid) {
      if (!validUid(uid)) return { schema: 1, uid: "", days: [] };
      const raw = storage.getItem(PREFIX + uid);
      if (!raw) return { schema: 1, uid: String(uid), days: [] };
      const value = JSON.parse(raw);
      if (!value || value.schema !== 1 || value.uid !== String(uid) || !Array.isArray(value.days)) {
        throw new Error("本地记录格式异常，已停止写入以保护原数据");
      }
      return value;
    }
    function load(uid) {
      try {
        const value = read(uid);
        const days = prune(value.days, recommendationDate(clock()), retentionLimit());
        if (validUid(uid) && JSON.stringify(days) !== JSON.stringify(value.days)) {
          storage.setItem(PREFIX + uid, JSON.stringify(Object.assign({}, value, { days })));
        }
        return days;
      } catch (e) { onError(e); return []; }
    }
    function save(uid, date, tracks, source) {
      if (!validUid(uid)) return false;
      try {
        const normalized = cloneTracks(tracks);
        const today = recommendationDate(clock());
        if (!normalized.length || !eligible(date, today)) return false;
        // Re-read for every write so independent client windows do not overwrite other dates.
        const state = read(uid);
        const days = prune(state.days, today, retentionLimit());
        const old = days.find(item => item.date === date);
        const stamp = new Date(clock()).toISOString();
        const item = { date, firstOpenedAt: old ? old.firstOpenedAt : stamp,
          lastOpenedAt: stamp, source: source || "daily", tracks: normalized };
        const next = [item, ...days.filter(day => day.date !== date)].sort((a, b) => b.date.localeCompare(a.date));
        storage.setItem(PREFIX + uid, JSON.stringify({ schema: 1, uid: String(uid), days: next }));
        return true;
      } catch (e) { onError(e); return false; }
    }
    return { load, save, eligible, get: (uid, date) => load(uid).find(day => day.date === date),
      dates: uid => load(uid).map(day => day.date),
      export: uid => JSON.stringify({ schema: 1, uid: String(uid), days: load(uid) }, null, 2) };
  }
  return { PREFIX, DAYS, SETTINGS_KEY, validDays, readSettings, writeSettings, dateKey, recommendationDate, dayNumber, validUid, cloneTracks, prune, mergeDates, createArchive };
});

