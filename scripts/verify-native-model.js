"use strict";
// Optional local verification against the two extracted, installed client models.
// The client code is NOT distributed in either release archive.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");
const Adapter = require("../src/adapter.js");
const root = path.resolve(__dirname, "..");
function readModel(file, api) {
  const scope = { webpackJsonp: [] };
  vm.runInNewContext(fs.readFileSync(path.join(root, "research", file), "utf8"), scope, { timeout: 1000 });
  const factories = scope.webpackJsonp[0][1];
  const factory = Object.values(factories)[0];
  const module = { exports: {} };
  const require = () => api;
  require.r = target => Object.defineProperty(target, "__esModule", { value: true });
  require.d = (target, name, getter) => Object.defineProperty(target, name, { enumerable: true, get: getter });
  factory(module, module.exports, require);
  return module.exports.default();
}
(async () => {
  const requests = [];
  const official = ["2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06"];
  const tracks = [{ id: 101, name: "合同测试歌曲", artists: [{ id: 1, name: "歌手" }], album: { id: 2, name: "专辑" }, duration: 180000 }];
  const historyModel = await readModel("181.chunk.1482700000000.js", {
    sb: async () => ({ code: 200, data: { dates: official } }),
    rb: async ({ date }, { formatOption }) => {
      assert.equal(formatOption.uid, 123);
      requests.push(date);
      return [{ ...tracks[0], id: 201 + official.indexOf(date) }];
    }
  });
  const dailyModel = await readModel("179.chunk.1482700000000.js", { c: async () => ({ recommend: tracks, showFreeTag: false }) });
  const models = [historyModel, dailyModel];
  const memory = new Map(), listeners = new Set();
  const archive = Core.createArchive({ getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) }, () => new Date(2026, 10, 11, 12));
  let state = { host: { uid: 123 }, [historyModel.namespace]: historyModel.state, [dailyModel.namespace]: dailyModel.state };
  const history = { location: { pathname: "/dailyRecommend" } };
  const store = { getState: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  store.dispatch = function (action) {
    const parts = action.type.split("/"), namespace = parts[0], key = parts[1];
    const model = models.find(model => model.namespace === namespace);
    if (!model) return action;
    if (model.reducers[key]) {
      state = Object.assign({}, state, { [namespace]: model.reducers[key](state[namespace], action) });
      listeners.forEach(fn => fn()); return action;
    }
    return Adapter.runEffect(model.effects[key], action, {
      call: (fn, ...args) => fn(...args), select: selector => selector(state),
      put: action => store.dispatch({ ...action, type: namespace + "/" + action.type })
    });
  };
  const registeredModels = models.map(model => ({
    ...model,
    effects: Object.fromEntries(Object.entries(model.effects).map(([name, effect]) => [model.namespace + "/" + name, effect]))
  }));
  const tool = { app: { _store: store, _models: registeredModels }, getStore: store.getState, getHistory: () => history };
  const attached = Adapter.attach(tool, archive, { calendar: true, clock: () => new Date(2026, 10, 11, 12) });
  await store.dispatch({ type: Adapter.DAILY + "/getDailyRecommend", payload: { uid: 123 } });
  assert.equal(archive.get("123", "2026-11-11").tracks[0].id, 101);
  history.location.pathname = "/historyRecommend";
  const dates = await store.dispatch({ type: Adapter.HISTORY + "/getDates", payload: { uid: 123 } });
  assert.deepEqual(Array.from(dates), ["2026-11-11", ...official]);
  await store.dispatch({ type: Adapter.HISTORY + "/getHistorySongs", payload: { date: "2026-11-11", index: 0, uid: 123 } });
  assert.equal(requests.includes("2026-11-11"), false);
  assert.equal(state[Adapter.HISTORY].trackList[0][0].id, 101);
  assert.equal(await attached.selectDate("2026-11-10"), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, official);
  assert.equal(state[Adapter.HISTORY].trackList[0][0].id, 201);
  assert.deepEqual(archive.dates("123"), ["2026-11-11", ...official]);
  assert.equal(await attached.selectDate("2026-11-06"), true);
  assert.equal(state[Adapter.HISTORY].trackList[0][0].id, 205);
  attached.dispose();
  console.log("PASS: installed NetEase 3.1.42 native daily/history model contracts (isolated VM, stubbed network)");
})().catch(error => { console.error(error); process.exitCode = 1; });

