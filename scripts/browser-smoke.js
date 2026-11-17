"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><html><body><h2>历史日推</h2><main id="settings"></main></body></html>');
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const app = fs.readFileSync(path.join(root, "research", "app.html"), "utf8");
    const runtime = Array.from(app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
      .map(match => match[1]).find(code => code.includes("r.c=f"));
    assert.ok(runtime, "Native installed-client webpack runtime not found");
    await page.addScriptTag({ content: runtime });
    await page.evaluate(() => {
      const H = "page:historyRecommend", D = "page:dailyRecommend";
      let state = { host: { uid: 123 }, [D]: { result: {} }, [H]: { dates: [], currentIndex: 0, trackList: {} } };
      const listeners = [];
      const history = { location: { pathname: "/dailyRecommend" } };
      const nativeDispatch = action => {
        if (action.type === D + "/getDailyRecommend") {
          state = Object.assign({}, state, { [D]: { result: { page: { more: false }, records: [{ id: 1234, name: "浏览器验证歌曲" }] } } });
          listeners.forEach(fn => fn()); return Promise.resolve();
        }
        if (action.type.startsWith(H + "/update")) state = Object.assign({}, state, { [H]: Object.assign({}, state[H], action.payload) });
        listeners.forEach(fn => fn()); return action;
      };
      const model = { namespace: H, effects: {
        *getDates(action, { call, put }) { const dates = yield call(async () => []); yield put({ type: "updateDates", payload: { dates } }); return dates; },
        *getHistorySongs() { throw new Error("Local songs should not call the server"); }
      } };
      const store = { getState: () => state, dispatch: nativeDispatch, subscribe: fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); } };
      const tool = { getStore: () => state, getHistory: () => history, app: { _store: store, _models: [model] } };
      window.smoke = { tool, store, history };
      window.webpackJsonp.push([["smoke-store"], { "smoke-store": module => { module.exports = { a: tool }; } }, [["smoke-store"]]]);
      window.plugin = { onLoad: fn => { window.startPlugin = fn; }, onConfig: fn => { window.configPlugin = fn; } };
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, "dist", "main.js"), "utf8") });
    await page.evaluate(async () => {
      window.startPlugin();
      document.querySelector("#settings").appendChild(window.configPlugin());
      await window.smoke.store.dispatch({ type: "page:dailyRecommend/getDailyRecommend", payload: { uid: 123 } });
      window.smoke.history.location.pathname = "/historyRecommend";
      const dates = await window.smoke.store.dispatch({ type: "page:historyRecommend/getDates", payload: { uid: 123 } });
      await window.smoke.store.dispatch({ type: "page:historyRecommend/getHistorySongs", payload: { date: dates[0], index: 0, uid: 123 } });
    });
    await page.waitForSelector("#bncm-daily-history-calendar-bar");
    const result = await page.evaluate(() => ({
      diagnostics: window.__bncmDailyHistory30.diagnostics(),
      badge: document.querySelector("#bncm-daily-history-note").textContent,
      songId: window.smoke.store.getState()["page:historyRecommend"].trackList[0][0].id,
      count: document.querySelector(".dh-account").textContent
    }));
    assert.equal(result.diagnostics.connected, true);
    assert.equal(result.songId, 1234);
    assert.match(result.badge, /已记录 1 天/);
    assert.match(result.count, /已记录 1 天/);
    assert.deepEqual(errors, []);
    // Reload the whole page and verify that browser storage survived.
    await page.reload();
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("bncm.daily-history.v1.123")));
    assert.equal(persisted.days.length, 1);
    assert.equal(persisted.days[0].tracks[0].id, 1234);
    console.log("PASS: Edge headless bundle/load/config/native-runtime/storage smoke test (mock page/store)");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

