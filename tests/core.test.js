"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/core.js");
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const tracks = [{ id: 101, name: "歌曲一", ar: [{ id: 9, name: "歌手" }], al: { id: 7, name: "专辑", picUrl: "https://p1.music.126.net/cover.jpg" }, dt: 180000 }];
test("保留30个推荐日，处理跨年、闰日和无效日期", () => {
  const days = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 0, 15, 12); d.setDate(d.getDate() - i);
    days.push({ date: Core.dateKey(d), tracks });
  }
  const result = Core.prune(days, "2026-01-15");
  assert.equal(result.length, 30);
  assert.equal(result[29].date, "2025-12-17");
  assert.ok(Number.isNaN(Core.dayNumber("2026-02-29")));
  assert.ok(Number.isFinite(Core.dayNumber("2024-02-29")));
  assert.deepEqual(Core.prune([{ date: "2026-01-16", tracks }], "2026-01-15"), []);
});
test("06:00更新边界不会把昨天的推荐记成今天", () => {
  assert.equal(Core.recommendationDate(new Date(2026, 10, 11, 5, 59, 59)), "2026-11-10");
  assert.equal(Core.recommendationDate(new Date(2026, 10, 11, 6, 0)), "2026-11-11");
  assert.equal(Core.recommendationDate(new Date(2026, 0, 1, 1)), "2025-12-31");
});
test("升级保留记录，关闭清除仍能保存，重新开启时按手填天数清理", () => {
  const memory = storage(), now = () => new Date(2026, 10, 11, 12);
  const archive = Core.createArchive(memory, now);
  assert.deepEqual(Core.readSettings(memory), { autoClear: true, days: 30 });
  assert.equal(archive.save("123", "2026-11-01", tracks), true);
  Core.writeSettings(memory, { autoClear: false, days: 2 });
  assert.equal(archive.save("123", "2025-11-11", tracks), true);
  assert.equal(archive.save("123", "2026-11-11", tracks), true);
  assert.deepEqual(Core.createArchive(memory, now).dates("123"), ["2026-11-11", "2026-11-01", "2025-11-11"]);
  assert.throws(() => Core.writeSettings(memory, { autoClear: true, days: 0 }), /正整数/);
  assert.deepEqual(Core.readSettings(memory), { autoClear: false, days: 2 });
  Core.writeSettings(memory, { autoClear: true, days: 2 });
  assert.deepEqual(archive.dates("123"), ["2026-11-11"]);
  assert.equal(JSON.parse(memory.getItem(Core.PREFIX + "123")).days.length, 1);
});
test("同日更新不重复，重启仍可读取，账号隔离", () => {
  const memory = storage();
  let now = new Date(2026, 10, 11, 12);
  const archive = Core.createArchive(memory, () => now);
  assert.equal(archive.save("123", "2026-11-11", tracks), true);
  const first = archive.load("123")[0].firstOpenedAt;
  now = new Date(2026, 10, 11, 13);
  archive.save("123", "2026-11-11", [{ id: 102, name: "更新后的歌曲" }]);
  archive.save("456", "2026-11-11", tracks);
  const reopened = Core.createArchive(memory, () => now);
  assert.equal(reopened.load("123").length, 1);
  assert.equal(reopened.load("123")[0].tracks[0].id, 102);
  assert.equal(reopened.load("123")[0].firstOpenedAt, first);
  assert.equal(reopened.load("456")[0].tracks[0].id, 101);
  assert.equal(reopened.save("0", "2026-11-11", tracks), false);
});
test("启动时也清理过期数据，并保留其它窗口写入的日期", () => {
  const memory = storage();
  let now = new Date(2026, 10, 11, 12);
  const a = Core.createArchive(memory, () => now);
  const b = Core.createArchive(memory, () => now);
  a.save("123", "2026-10-13", tracks);
  b.save("123", "2026-11-10", tracks);
  a.save("123", "2026-11-11", tracks);
  assert.equal(b.load("123").length, 3);
  now = new Date(2026, 10, 12, 12);
  assert.deepEqual(a.dates("123"), ["2026-11-11", "2026-11-10"]);
  assert.equal(JSON.parse(memory.getItem(Core.PREFIX + "123")).days.length, 2);
});
test("损坏记录和磁盘配额错误不会吞掉原数据或谎报成功", () => {
  const memory = storage(), errors = [];
  memory.setItem(Core.PREFIX + "123", "broken-json");
  const a = Core.createArchive(memory, () => new Date(2026, 10, 11, 12), e => errors.push(e));
  assert.equal(a.save("123", "2026-11-11", tracks), false);
  assert.equal(memory.getItem(Core.PREFIX + "123"), "broken-json");
  const b = Core.createArchive({ getItem: () => null, setItem() { throw new Error("QuotaExceeded"); } },
    () => new Date(2026, 10, 11, 12), e => errors.push(e));
  assert.equal(b.save("123", "2026-11-11", tracks), false);
  assert.equal(errors.length, 2);
});
test("保存完整歌曲元信息，不保存音频地址或认证信息", () => {
  const result = Core.cloneTracks([...tracks, tracks[0], { id: -1, name: "无效" }, { id: 102, name: "另一首", url: "audio", cookie: "secret", token: "secret" }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].al.picUrl, tracks[0].al.picUrl);
  assert.equal(result[1].url, undefined);
  assert.equal(result[1].cookie, undefined);
  assert.equal(result[1].token, undefined);
  assert.deepEqual(Core.mergeDates(["2026-11-10", "2026-11-08"], ["2026-11-11", "2026-11-08"]), ["2026-11-11", "2026-11-10", "2026-11-08"]);
});
module.exports = { storage, tracks };

