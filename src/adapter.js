(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.BNCMDailyHistoryCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BNCMDailyHistoryAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";
  const DAILY = "page:dailyRecommend";
  const HISTORY = "page:historyRecommend";
  const OFFICIAL_HISTORY_LIMIT = 5;
  const isDaily = path => /^\/dailyRecommend\/?$/.test(path || "");
  const isHistory = path => /^\/historyRecommend\/?$/.test(path || "");

  // Capture webpack 4's require without running any of the client's unexecuted modules.
  function captureRequire(win) {
    if (!win.webpackJsonp || !Array.isArray(win.webpackJsonp) || win.webpackJsonp.push === Array.prototype.push) return null;
    let captured = null;
    const id = "bncm-daily-history-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    win.webpackJsonp.push([[id], { [id]: function (module, exports, require) { captured = require; } }, [[id]]]);
    if (captured) { delete captured.m[id]; delete captured.c[id]; }
    return captured;
  }
  function findTool(require) {
    if (!require || !require.c) return null;
    for (const key of Object.keys(require.c)) {
      const exports = require.c[key].exports;
      const values = [exports];
      if (exports && (typeof exports === "object" || typeof exports === "function")) {
        for (const name of Object.keys(exports)) {
          try { values.push(exports[name]); } catch (_) { /* Ignore unrelated getters. */ }
        }
      }
      for (const value of values) {
        if (value && typeof value.getStore === "function" && typeof value.getHistory === "function" &&
          value.app && value.app._store && typeof value.app._store.subscribe === "function") return value;
      }
    }
    return null;
  }
  // The two verified 3.1.42 history effects only use call/put/select. Running them with
  // these helpers lets us merge dates BEFORE the native reducer and renderer see them.
  async function runEffect(effect, action, helpers) {
    const iterator = effect(action, helpers);
    if (!iterator || typeof iterator.next !== "function") throw new Error("历史日推接口结构已变更");
    let step = iterator.next();
    while (!step.done) {
      try { step = iterator.next(await step.value); }
      catch (error) { step = iterator.throw(error); }
    }
    return step.value;
  }
  function attach(tool, archive, options) {
    options = options || {};
    const clock = options.clock || (() => new Date());
    const status = options.status || (() => {});
    const calendar = options.calendar === true;
    const store = tool.app._store;
    const originalDispatch = store.dispatch;
    const history = tool.getHistory();
    let disposed = false;
    let previousUid = String((store.getState().host || {}).uid || "");
    let epoch = 0;
    let availableDates = [];
    const pending = new Map();
    const uid = () => String((store.getState().host || {}).uid || "");
    const path = () => (history.location || {}).pathname || "";
    const sameAccount = (owner, generation) => !disposed && owner === uid() && generation === epoch;
    const send = action => originalDispatch.call(store, action);
    const effectFor = name => {
      const model = (tool.app._models || []).find(model => model.namespace === HISTORY);
      const effects = model && model.effects;
      // Dva prefixes effect keys when it registers the model in the running client.
      let effect = effects && (effects[HISTORY + "/" + name] || effects[name]);
      if (Array.isArray(effect)) effect = effect[0];
      return typeof effect === "function" ? effect : null;
    };
    function snapshot(owner, date, rows, source) {
      if (archive.save(owner, date, rows, source)) status("recorded", { uid: owner, date, count: rows.length });
    }
    function onState() {
      if (disposed) return;
      const owner = uid();
      if (owner !== previousUid) {
        epoch++;
        previousUid = owner;
        availableDates = [];
        archive.load(owner);
        if (store.getState()[HISTORY]) {
          send({ type: HISTORY + "/updateTrackList", payload: { trackList: {} } });
          send({ type: HISTORY + "/updateDates", payload: { dates: [] } });
          send({ type: HISTORY + "/updateCurrentIndex", payload: { currentIndex: 0 } });
        }
        status("account", { uid: owner });
        return;
      }
    }
    function makeHelpers(owner, generation, transformCall, transformPut) {
      return {
        call: (fn, ...args) => Promise.resolve()
          .then(() => sameAccount(owner, generation) ? fn(...args) : undefined)
          .then(transformCall || (value => value)),
        select: selector => selector(store.getState()),
        put: action => {
          if (!sameAccount(owner, generation)) return undefined;
          const prefixed = Object.assign({}, action, { type: action.type.includes("/") ? action.type : HISTORY + "/" + action.type });
          return transformPut ? transformPut(prefixed) : send(prefixed);
        }
      };
    }
    function mergedDates(owner, server) { return Core.mergeDates(server, archive.dates(owner)); }
    function putRows(owner, generation, date, rows) {
      if (!sameAccount(owner, generation)) return;
      const state = store.getState()[HISTORY];
      if (!state) return;
      const index = (state.dates || []).indexOf(date);
      if (index < 0) return;
      const trackList = Object.assign({}, state.trackList || {}, { [index]: rows });
      send({ type: HISTORY + "/updateTrackList", payload: { trackList } });
    }
    function showDates(dates, rows, index) {
      send({ type: HISTORY + "/updateTrackList", payload: { trackList: {} } });
      send({ type: HISTORY + "/updateDates", payload: { dates } });
      send({ type: HISTORY + "/updateTrackList", payload: { trackList: rows } });
      send({ type: HISTORY + "/updateCurrentIndex", payload: { currentIndex: index } });
    }
    async function getDates(action, effect, owner, generation) {
      const before = store.getState()[HISTORY] || {};
      const selectedDate = (before.dates || [])[before.currentIndex || 0];
      const byDate = new Map((before.dates || []).map((date, i) => [date, (before.trackList || {})[i]]));
      let officialDates = [];
      const helpers = makeHelpers(owner, generation,
        server => {
          officialDates = Core.mergeDates(server, []);
          return mergedDates(owner, officialDates);
        },
        action => {
          if (action.type !== HISTORY + "/updateDates") return send(action);
          availableDates = action.payload.dates;
          const dates = calendar
            ? [availableDates.includes(selectedDate) ? selectedDate : availableDates[0]].filter(Boolean)
            : availableDates;
          // Indices change when a new local date is inserted. Never leave old rows at a new date's index.
          const rows = {};
          const localByDate = new Map(archive.load(owner).map(item => [item.date, item]));
          dates.forEach((date, i) => {
            const local = localByDate.get(date);
            if (local) rows[i] = local.tracks;
            else if (byDate.get(date)) rows[i] = byDate.get(date);
          });
          showDates(dates, rows, Math.max(0, dates.indexOf(selectedDate)));
          status("history", { dates: dates.length, local: archive.dates(owner).length });
        });
      let dates;
      try { dates = await runEffect(effect, action, helpers); }
      catch (error) {
        // Offline: show already recorded local dates; no server history is fabricated.
        const dates = mergedDates(owner, []);
        if (!dates.length) throw error;
        helpers.put({ type: "updateDates", payload: { dates } });
        if (sameAccount(owner, generation)) status("offline", { message: String(error.message || error) });
        return dates;
      }
      if (sameAccount(owner, generation) && isHistory(path()) && officialDates.length) {
        runPending(owner, generation, "syncOfficialHistory", "", () => syncOfficialHistory(officialDates, owner, generation));
      }
      return dates;
    }
    async function getSongs(action, effect, owner, generation, source) {
      if (!sameAccount(owner, generation)) return;
      const date = action.payload && action.payload.date;
      const local = archive.get(owner, date);
      if (local) { putRows(owner, generation, date, local.tracks); return; }
      const requestedIndex = action.payload.index;
      const helpers = makeHelpers(owner, generation, null, update => {
        if (update.type !== HISTORY + "/updateTrackList") return send(update);
        const rows = update.payload.trackList[requestedIndex];
        if (Array.isArray(rows) && sameAccount(owner, generation)) {
          snapshot(owner, date, rows, source);
          putRows(owner, generation, date, rows);
        }
      });
      return runEffect(effect, action, helpers);
    }
    function runPending(owner, generation, name, date, run) {
      const key = [owner, generation, name, date].join(":");
      if (pending.has(key)) return pending.get(key);
      const promise = Promise.resolve().then(run);
      pending.set(key, promise);
      promise.then(
        () => pending.delete(key),
        error => {
          pending.delete(key);
          if (sameAccount(owner, generation)) status("error", { message: String(error.message || error) });
        }
      );
      return promise;
    }
    function loadHistorySongs(action, effect, owner, generation, source) {
      return runPending(owner, generation, "getHistorySongs", action.payload.date,
        () => getSongs(action, effect, owner, generation, source));
    }
    async function syncOfficialHistory(officialDates, owner, generation) {
      const effect = effectFor("getHistorySongs");
      if (!effect || !sameAccount(owner, generation)) return;
      const today = Core.recommendationDate(clock());
      const recentDates = officialDates.slice(0, OFFICIAL_HISTORY_LIMIT).filter(date => archive.eligible(date, today));
      const savedDates = new Set(archive.dates(owner));
      const missing = recentDates.filter(date => !savedDates.has(date));
      if (!missing.length) return;
      for (const date of missing) {
        if (!sameAccount(owner, generation)) return;
        const state = store.getState();
        const historyState = state[HISTORY];
        const index = historyState ? historyState.dates.indexOf(date) : -1;
        if (index < 0 && !calendar) continue;
        const action = { type: HISTORY + "/getHistorySongs", payload: { date, index, uid: state.host.uid } };
        try {
          await loadHistorySongs(action, effect, owner, generation, "history-imported");
        } catch (_) {
          // A failed date remains eligible on the next visit. Continue with the other dates.
        }
      }
      if (sameAccount(owner, generation)) {
        const saved = new Set(archive.dates(owner));
        const count = recentDates.filter(date => saved.has(date)).length;
        status("history-synced", { count, total: recentDates.length });
      }
    }
    function dispatch(action) {
      if (disposed || !action || typeof action.type !== "string") return originalDispatch.apply(this, arguments);
      const owner = uid();
      const generation = epoch;
      if (Core.validUid(owner) && isDaily(path()) && action.type === DAILY + "/getDailyRecommend") {
        const requestUid = action.payload && action.payload.uid;
        if (requestUid != null && String(requestUid) !== owner) return originalDispatch.apply(this, arguments);
        const date = Core.recommendationDate(clock());
        const before = (store.getState()[DAILY] || {}).result;
        const result = originalDispatch.apply(this, arguments);
        // Observe the real page request, never request recommendations on a timer.
        // Cached Redux updates, background prefetch and POP restoration do not count.
        return Promise.resolve(result).then(value => {
          const daily = (store.getState()[DAILY] || {}).result;
          if (!(value && value.error) && sameAccount(owner, generation) && daily && daily !== before && daily.page && daily.page.more === false) {
            snapshot(owner, date, daily.records, "daily");
          }
          return value;
        });
      }
      if (Core.validUid(owner) && isHistory(path()) &&
        (action.type === HISTORY + "/getDates" || action.type === HISTORY + "/getHistorySongs")) {
        const requestUid = action.payload && action.payload.uid;
        if (requestUid != null && String(requestUid) !== owner) return Promise.resolve([]);
        const name = action.type.slice(HISTORY.length + 1);
        const effect = effectFor(name);
        if (effect) {
          if (name === "getDates") {
            return runPending(owner, generation, name, "", () => getDates(action, effect, owner, generation));
          }
          if (action.payload) return loadHistorySongs(action, effect, owner, generation, "history-opened");
        }
        status("unsupported", { message: "未找到原生历史日推模型，请重启网易云后再打开历史日推" });
      }
      return originalDispatch.apply(this, arguments);
    }
    store.dispatch = dispatch;
    const unsubscribe = store.subscribe(onState);
    archive.load(uid());
    status("ready", { uid: uid() });
    function selectDate(date) {
      const state = store.getState()[HISTORY];
      if (!state || !isHistory(path()) || !Core.validUid(uid()) || !availableDates.includes(date)) return Promise.resolve(false);
      const owner = uid();
      const generation = epoch;
      const effect = effectFor("getHistorySongs");
      if (!effect) return Promise.resolve(false);
      const previousIndex = (state.dates || []).indexOf(date);
      const index = calendar ? 0 : previousIndex;
      if (calendar && previousIndex < 0) {
        const local = archive.get(owner, date);
        showDates([date], local ? { 0: local.tracks } : {}, 0);
      } else {
        send({ type: HISTORY + "/updateCurrentIndex", payload: { currentIndex: index } });
      }
      return loadHistorySongs({ type: HISTORY + "/getHistorySongs", payload: { date, index, uid: store.getState().host.uid } },
        effect, owner, generation, "history-opened").then(() => sameAccount(owner, generation));
    }
    return { store, history, uid, selectDate, dates: () => availableDates.slice(), dispose() {
      disposed = true;
      unsubscribe();
      if (store.dispatch === dispatch) store.dispatch = originalDispatch;
    } };
  }
  return { DAILY, HISTORY, isDaily, isHistory, captureRequire, findTool, runEffect, attach };
});

