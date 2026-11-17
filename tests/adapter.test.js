"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");
const A = require("../src/adapter.js");
const H = A.HISTORY, D = A.DAILY;
const song = id => [{ id, name: "歌曲" + id, artists: [{ id: 9, name: "歌手" }], duration: 180000 }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, val) => memory.set(key, val) };
  let now = new Date(2026, 10, 11, 12);
  const archive = Core.createArchive(storage, () => now);
  let state = { host: { uid: 123 }, [D]: { result: {} }, [H]: { dates: [], currentIndex: 0, trackList: {} } };
  const listeners = new Set(), calls = [], statuses = [];
  const history = { location: { pathname: "/home" } };
  const reduce = action => {
    calls.push(action);
    if (action.type === "uid") state = Object.assign({}, state, { host: { uid: action.uid } });
    else if (action.type === D + "/updateResult") state = Object.assign({}, state, { [D]: { result: action.payload } });
    else if (action.type.startsWith(H + "/update")) state = Object.assign({}, state, { [H]: Object.assign({}, state[H], action.payload) });
    for (const listener of listeners) listener();
    if (action.type === D + "/getDailyRecommend") {
      return (options.daily ? options.daily() : Promise.resolve(song(101))).then(records => {
        reduce({ type: D + "/updateResult", payload: { records, page: { more: false } } }); return { ok: true };
      });
    }
    return action;
  };
  const store = { getState: () => state, dispatch: reduce, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const model = { namespace: H, effects: {
    // Equivalent call/put/select contracts to the installed 3.1.42 native model.
    *getDates(action, { call, put }) {
      const dates = yield call(options.dates || (() => Promise.resolve(["2026-11-10", "2026-11-08"])));
      yield put({ type: "updateDates", payload: { dates } }); return dates;
    },
    *getHistorySongs({ payload: { date, index, uid } }, { call, put, select }) {
      const rows = yield call(options.songs || (() => Promise.resolve(song(301))), { date }, uid);
      const trackList = Object.assign({}, yield select(state => state[H].trackList));
      trackList[index] = rows;
      yield put({ type: "updateTrackList", payload: { trackList } });
    }
  } };
  model.effects = Object.fromEntries(Object.entries(model.effects).map(([name, effect]) => [H + "/" + name, effect]));
  const tool = { app: { _store: store, _models: [model] }, getStore: () => state, getHistory: () => history };
  const connection = A.attach(tool, archive, { calendar: options.calendar, clock: () => now, status: (...args) => statuses.push(args) });
  return { archive, store, tool, history, calls, connection, statuses, clock: value => { now = value; } };
}
test("仅真正点开每日推荐并加载成功时记录，背景请求、缓存恢复不记录", async () => {
  const f = fixture();
  await f.store.dispatch({ type: D + "/getDailyRecommend" });
  assert.deepEqual(f.archive.dates("123"), []);
  f.history.location.pathname = "/dailyRecommend";
  f.store.dispatch({ type: D + "/updateResult", payload: { records: song(99), page: { more: false } } });
  assert.deepEqual(f.archive.dates("123"), []);
  const result = await f.store.dispatch({ type: D + "/getDailyRecommend" });
  assert.deepEqual(result, { ok: true });
  assert.equal(f.archive.get("123", "2026-11-11").tracks[0].id, 101);
});
test("日历可切换超出最近五个位置的日期，原生歌曲行随日期更新", async () => {
  const official = ["2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05"];
  const f = fixture({ calendar: true, dates: async () => official,
    songs: async ({ date }) => song(Number(date.slice(-2))) });
  f.history.location.pathname = "/historyRecommend";
  f.archive.save("123", "2026-11-01", song(101));
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  assert.deepEqual(f.connection.dates(), [...official, "2026-11-01"]);
  assert.deepEqual(f.store.getState()[H].dates, [official[0]]);
  assert.equal(await f.connection.selectDate("2026-11-01"), true);
  assert.equal(f.store.getState()[H].trackList[0][0].id, 101);
  assert.deepEqual(f.store.getState()[H].dates, ["2026-11-01"]);
  assert.equal(await f.connection.selectDate(official[5]), true);
  assert.equal(f.store.getState()[H].trackList[0][0].id, 5);
  assert.equal(await f.connection.selectDate("2026-11-02"), false);
  assert.deepEqual(f.store.getState()[H].dates, [official[5]]);
  await flush();
  assert.ok(f.archive.get("123", official[4]));
});
test("请求失败不记录，失败不会变成成功", async () => {
  const f = fixture({ daily: () => Promise.reject(new Error("network")) });
  f.history.location.pathname = "/dailyRecommend";
  await assert.rejects(f.store.dispatch({ type: D + "/getDailyRecommend" }), /network/);
  assert.deepEqual(f.archive.dates("123"), []);
});
test("日期直接合并到原生模型，打开已存日期时只读取本地歌曲", async () => {
  const requests = [];
  const f = fixture({ songs: ({ date }) => { requests.push(date); return song(300); } });
  f.archive.save("123", "2026-11-11", song(101));
  f.history.location.pathname = "/historyRecommend";
  const dates = await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  assert.deepEqual(dates, ["2026-11-11", "2026-11-10", "2026-11-08"]);
  await f.store.dispatch({ type: H + "/getHistorySongs", payload: { date: dates[0], index: 0, uid: 123 } });
  assert.equal(f.store.getState()[H].trackList[0][0].id, 101);
  assert.equal(requests.includes(dates[0]), false);
  assert.equal(f.calls.some(a => /playlist\/(create|add)/.test(a.type)), false);
});
test("插入本地日期后按日期重排已有行，播放列表索引不串日", async () => {
  const f = fixture(); f.history.location.pathname = "/historyRecommend";
  f.store.dispatch({ type: H + "/updateDates", payload: { dates: ["2026-11-10", "2026-11-08"] } });
  f.store.dispatch({ type: H + "/updateTrackList", payload: { trackList: { 0: song(201), 1: song(202) } } });
  f.store.dispatch({ type: H + "/updateCurrentIndex", payload: { currentIndex: 1 } });
  f.archive.save("123", "2026-11-11", song(101));
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  const h = f.store.getState()[H];
  assert.equal(h.currentIndex, 2);
  assert.equal(h.trackList[0][0].id, 101);
  assert.equal(h.trackList[1][0].id, 201);
  assert.equal(h.trackList[2][0].id, 202);
});
test("远程历史晚到时仍放回请求日期，而非过时索引", async () => {
  const wait = deferred(); const f = fixture({ songs: () => wait.promise });
  f.history.location.pathname = "/historyRecommend";
  f.store.dispatch({ type: H + "/updateDates", payload: { dates: ["2026-11-10", "2026-11-08"] } });
  const loading = f.store.dispatch({ type: H + "/getHistorySongs", payload: { date: "2026-11-10", index: 0, uid: 123 } });
  await Promise.resolve(); await Promise.resolve();
  f.archive.save("123", "2026-11-11", song(101));
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  wait.resolve(song(200)); await loading;
  assert.equal(f.store.getState()[H].trackList[0][0].id, 101);
  assert.equal(f.store.getState()[H].trackList[1][0].id, 200);
  assert.deepEqual(f.archive.dates("123"), ["2026-11-11", "2026-11-10"]);
});
test("打开历史页补存最近五个官方日期，已有记录保留，重开不重复请求", async () => {
  const official = ["2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05"];
  const requested = [];
  const f = fixture({
    dates: async () => [...official].reverse(),
    songs: async ({ date }, uid) => {
      assert.equal(uid, 123);
      requested.push(date);
      return song(Number(date.slice(-2)));
    }
  });
  f.archive.save("123", "2026-11-09", song(101));
  f.history.location.pathname = "/historyRecommend";
  const action = { type: H + "/getDates", payload: { uid: 123 } };
  assert.deepEqual(await f.store.dispatch(action), official);
  await flush();
  assert.deepEqual(f.archive.dates("123"), official.slice(0, 5));
  assert.deepEqual(requested, [official[0], ...official.slice(2, 5)]);
  assert.equal(f.archive.get("123", official[1]).tracks[0].id, 101);
  assert.equal(f.archive.get("123", official[0]).source, "history-imported");
  assert.equal(f.store.getState()[H].trackList[4][0].id, 6);
  await f.store.dispatch(action);
  await flush();
  assert.equal(requested.length, 4);
});
test("补存单日失败时继续保存其他日期，重开只重试遗漏日期", async () => {
  const official = ["2026-11-10", "2026-11-08", "2026-10-12"];
  const requested = [];
  const f = fixture({
    dates: async () => official,
    songs: async ({ date }) => {
      const firstRequest = !requested.includes(date);
      requested.push(date);
      if (date === official[0] && firstRequest) throw new Error("temporary");
      return song(301);
    }
  });
  f.history.location.pathname = "/historyRecommend";
  const action = { type: H + "/getDates", payload: { uid: 123 } };
  await f.store.dispatch(action);
  await flush();
  assert.deepEqual(f.archive.dates("123"), [official[1]]);
  assert.deepEqual(f.statuses.at(-1), ["history-synced", { count: 1, total: 2 }]);
  await f.store.dispatch(action);
  await flush();
  assert.deepEqual(f.archive.dates("123"), official.slice(0, 2));
  assert.deepEqual(requested, [official[0], official[1], official[0]]);
});
test("切换账号后丢弃旧请求，切回同账号也不会接受旧会话响应", async () => {
  const wait = deferred(), f = fixture({ songs: () => wait.promise });
  f.history.location.pathname = "/historyRecommend";
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  const request = f.store.dispatch({ type: H + "/getHistorySongs", payload: { date: "2026-11-10", index: 0, uid: 123 } });
  await Promise.resolve(); await Promise.resolve();
  f.store.dispatch({ type: "uid", uid: 456 }); f.store.dispatch({ type: "uid", uid: 123 });
  wait.resolve(song(300)); await request;
  assert.equal(f.archive.dates("123").length, 0);
  assert.equal(f.archive.dates("456").length, 0);
  assert.equal(f.store.getState()[H].trackList[0], undefined);
});
test("日推请求跨06:00，以请求所属推荐日归档；途中退出页面仍记录已打开的推荐", async () => {
  const wait = deferred(), f = fixture({ daily: () => wait.promise });
  f.clock(new Date(2026, 10, 11, 5, 59)); f.history.location.pathname = "/dailyRecommend";
  const result = f.store.dispatch({ type: D + "/getDailyRecommend" });
  f.clock(new Date(2026, 10, 11, 6, 1)); f.history.location.pathname = "/home";
  wait.resolve(song(500)); await result;
  assert.deepEqual(f.archive.dates("123"), ["2026-11-10"]);
});
test("新账号加载相同日期时不沿用旧账号缓存的歌曲", async () => {
  const f = fixture(); f.history.location.pathname = "/historyRecommend";
  f.archive.save("123", "2026-11-10", song(111));
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  assert.equal(f.store.getState()[H].trackList[0][0].id, 111);
  f.store.dispatch({ type: "uid", uid: 456 });
  await f.store.dispatch({ type: H + "/getDates", payload: { uid: 456 } });
  assert.equal(f.store.getState()[H].trackList[0], undefined);
  await f.store.dispatch({ type: H + "/getHistorySongs", payload: { date: "2026-11-10", index: 0, uid: 456 } });
  assert.equal(f.archive.get("456", "2026-11-10").tracks[0].id, 301);
  assert.equal(f.archive.get("123", "2026-11-10").tracks[0].id, 111);
});
test("官方历史不可用时可回看本地记录，同一日期并发点击只发一次请求", async () => {
  const f = fixture({ dates: () => Promise.reject(new Error("offline")) });
  f.archive.save("123", "2026-11-11", song(101)); f.history.location.pathname = "/historyRecommend";
  assert.deepEqual(await f.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } }), ["2026-11-11"]);
  assert.equal(f.statuses.some(s => s[0] === "offline"), true);
  let count = 0; const wait = deferred(), g = fixture({ songs: () => { count++; return wait.promise; } });
  g.history.location.pathname = "/historyRecommend";
  await g.store.dispatch({ type: H + "/getDates", payload: { uid: 123 } });
  const action = { type: H + "/getHistorySongs", payload: { date: "2026-11-10", index: 0, uid: 123 } };
  const a = g.store.dispatch(action), b = g.store.dispatch(action);
  wait.resolve(song(300)); await Promise.all([a, b]); assert.equal(count, 1);
});
test("未适配时保留原生处理，卸载恢复原调度器", async () => {
  const f = fixture(); f.history.location.pathname = "/historyRecommend"; f.tool.app._models = [];
  const action = { type: H + "/getDates", payload: { uid: 123 } };
  assert.equal(f.store.dispatch(action), action);
  assert.equal(f.statuses.some(s => s[0] === "unsupported"), true);
  f.connection.dispose(); assert.equal(f.store.dispatch(action), action);
});
test("只扫描已执行模块，不执行无关模块；webpack4捕获的模块立即清理", () => {
  const marker = {}, req = id => { const module = { exports: {} }; req.c[id] = module; req.m[id](module, module.exports, req); return module.exports; };
  req.m = {}; req.c = { 8: { exports: { a: { getStore() {}, getHistory() {}, app: { _store: { subscribe() {} } } } } } };
  const chunks = []; chunks.push = chunk => { Object.assign(req.m, chunk[1]); for (const entry of chunk[2]) req(entry[0]); };
  assert.equal(A.captureRequire({ webpackJsonp: chunks }), req);
  assert.deepEqual(Object.keys(req.m), []);
  assert.deepEqual(Object.keys(req.c), ["8"]);
  assert.ok(A.findTool(req));
  assert.equal(A.captureRequire({ webpackJsonp: [] }), null);
});

