(function () {
  "use strict";
  const Core = globalThis.BNCMDailyHistoryCore;
  const Adapter = globalThis.BNCMDailyHistoryAdapter;
  const Calendar = globalThis.BNCMDailyHistoryCalendar;
  const INSTANCE = "__bncmDailyHistory30";
  if (globalThis[INSTANCE]) globalThis[INSTANCE].dispose();
  let connection = null;
  let requireFn = null;
  let timer = null;
  let lastError = "";
  let message = "正在连接网易云页面…";
  let picker = null;
  let observer = null;
  let calendarUpdate = null;
  let calendarData = null;
  const configViews = new Set();
  const archive = Core.createArchive(localStorage, () => new Date(), error => {
    lastError = String(error.message || error);
    message = "保存失败：" + lastError;
    console.error("[日推本地记录]", error);
  });
  const labels = {
    ready: "已连接，点开每日推荐后自动记录", recorded: "已记录", history: "已接入原生历史日推",
    account: "已切换账号", offline: "当前显示本地记录（官方历史加载失败）",
    unsupported: "当前页面未适配", error: "读取失败"
  };
  function status(kind, detail) {
    message = labels[kind] || kind;
    if (kind === "recorded") message += ` ${detail.date} · ${detail.count} 首`;
    if (kind === "history-synced") {
      message = `已补存官方历史 ${detail.count}/${detail.total} 天`;
      if (detail.count < detail.total) message += "，下次打开历史日推时重试";
    }
    if (detail && detail.message) message += "：" + detail.message;
    calendarData = null;
    updateViews();
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function currentUid() { return connection ? connection.uid() : ""; }
  function updateViews() {
    const owner = currentUid();
    const settings = Core.readSettings(localStorage);
    let days;
    for (const view of configViews) {
      if (!view.isConnected && view.dataset.connected) { configViews.delete(view); continue; }
      if (view.isConnected) view.dataset.connected = "true";
      if (!days) days = archive.load(owner);
      view.querySelector(".dh-status").textContent = lastError ? "保存失败：" + lastError : message;
      view.querySelector(".dh-account").textContent = Core.validUid(owner)
        ? `当前账号 ${owner} · 已记录 ${days.length} 天` : "等待登录账号";
      const dates = view.querySelector(".dh-dates");
      const summary = days.map(day => `${day.date}　${day.tracks.length} 首`).join("\n");
      if (dates.dataset.summary !== summary) {
        dates.dataset.summary = summary;
        dates.textContent = summary || "暂无本地记录。打开“历史日推”补存最近的官方记录，打开“每日推荐”保存当天歌曲。";
      }
      const settingStatus = view.querySelector(".dh-retention-current");
      settingStatus.textContent = settings.autoClear ? `当前保留最近 ${settings.days} 天` : "自动清除已关闭";
    }
    scheduleCalendar();
  }
  function scheduleCalendar() {
    if (calendarUpdate != null || !picker) return;
    calendarUpdate = window.setTimeout(() => { calendarUpdate = null; updateCalendar(); }, 0);
  }
  function updateCalendar() {
    const existing = document.getElementById("bncm-daily-history-note");
    if (!connection || !Adapter.isHistory((connection.history.location || {}).pathname)) {
      if (existing) existing.remove();
      picker.update({ dates: [], saved: [], current: "", owner: "" }, null, null);
      return;
    }
    const owner = currentUid();
    const today = Core.recommendationDate(new Date());
    if (!calendarData || calendarData.owner !== owner || calendarData.today !== today) {
      calendarData = { owner, today, saved: archive.dates(owner) };
    }
    const state = connection.store.getState()[Adapter.HISTORY] || {};
    const settings = Core.readSettings(localStorage);
    const heading = document.querySelector(".Main_m1pcf2hi .recommend-title") ||
      Array.from(document.querySelectorAll("h1,h2,h3"))
      .find(node => node.textContent.trim() === "历史日推");
    let note = existing;
    if (heading && !note) {
      note = el("span");
      note.id = "bncm-daily-history-note";
      note.style.cssText = "font-size:12px;font-weight:normal;opacity:.65;margin-left:14px;white-space:nowrap";
      heading.insertAdjacentElement("afterend", note);
    }
    const retention = settings.autoClear ? `自动保留 ${settings.days} 天` : "自动清除已关闭";
    const label = `本地已记录 ${calendarData.saved.length} 天 · ${retention}`;
    if (note && note.textContent !== label) note.textContent = label;
    const tabList = document.querySelector("#page_pc_his_daily_recommend .StyledContent_s1vdm44a [role='tablist']");
    picker.update({ ...calendarData, dates: connection.dates(), current: (state.dates || [])[state.currentIndex || 0] || "" },
      tabList, note || heading);
  }
  async function exportRecords(button) {
    const owner = currentUid();
    if (!Core.validUid(owner)) { message = "请先登录网易云账号"; updateViews(); return; }
    try {
      const content = archive.export(owner);
      const base = await betterncm.app.getDataPath();
      const dir = base.replace(/[\\/]$/, "") + "/daily-history-exports";
      if (!(await betterncm.fs.exists(dir))) await betterncm.fs.mkdir(dir);
      const file = `${dir}/daily-history-${owner}-${Core.dateKey(new Date())}.json`;
      if ((await betterncm.fs.writeFileText(file, content)) === false) throw new Error("写入失败");
      button.parentElement.querySelector(".dh-export-path").textContent = "已导出：" + file;
    } catch (error) {
      button.parentElement.querySelector(".dh-export-path").textContent = "导出失败：" + String(error.message || error);
    }
  }
  function config() {
    const view = el("div");
    view.style.cssText = "padding:18px;line-height:1.8;max-width:760px";
    view.appendChild(el("h2", "日推本地记录"));
    const settings = Core.readSettings(localStorage);
    const autoClear = el("input");
    autoClear.type = "checkbox";
    autoClear.checked = settings.autoClear;
    const clearLabel = el("label");
    clearLabel.append(autoClear, el("span", " 自动清除过期本地记录"));
    view.appendChild(clearLabel);
    const days = el("input");
    days.type = "number";
    days.min = "1";
    days.step = "1";
    days.value = settings.days;
    days.style.cssText = "width:100px;margin:0 6px";
    const daysRow = el("div");
    const daysLabel = el("label", "自动保存时长");
    daysLabel.append(days, el("span", "天"));
    daysRow.appendChild(daysLabel);
    view.appendChild(daysRow);
    const save = el("button", "保存设置");
    save.type = "button";
    const result = el("span");
    result.setAttribute("role", "status");
    result.style.marginLeft = "8px";
    const current = el("p", "", "dh-retention-current");
    view.append(save, result, current);
    save.addEventListener("click", () => {
      try {
        lastError = "";
        Core.writeSettings(localStorage, { autoClear: autoClear.checked, days: days.valueAsNumber });
        archive.load(currentUid());
        calendarData = null;
        updateViews();
        refreshHistory();
        result.textContent = lastError ? "设置已保存，清理状态请见下方" : "设置已保存";
      } catch (error) { result.textContent = String(error.message || error); }
    });
    view.appendChild(el("p", "打开“历史日推”会补存最近五个官方历史日期。当天推荐在打开“每日推荐”时保存。"));
    view.appendChild(el("p", "", "dh-status"));
    view.appendChild(el("p", "", "dh-account"));
    const button = el("button", "导出本地记录备份");
    button.style.cssText = "padding:6px 14px;border-radius:6px;cursor:pointer";
    button.addEventListener("click", () => exportRecords(button));
    view.appendChild(button);
    view.appendChild(el("p", "", "dh-export-path"));
    const dates = el("div", "", "dh-dates");
    dates.style.whiteSpace = "pre-line";
    const records = el("details");
    const summary = el("summary", "已保存日期", "dh-dates-summary");
    summary.style.cursor = "pointer";
    records.append(summary, dates);
    view.appendChild(records);
    view.appendChild(el("p", "关闭自动清除后仍会继续保存。启用清除并缩短天数会移除超期本地记录。"));
    configViews.add(view);
    updateViews();
    return view;
  }
  function refreshHistory() {
    if (!connection || !Adapter.isHistory((connection.history.location || {}).pathname)) return;
    Promise.resolve(connection.store.dispatch({ type: Adapter.HISTORY + "/getDates",
      payload: { uid: currentUid() } })).catch(() => {});
  }
  function onStorage(event) {
    if (event.key !== Core.SETTINGS_KEY && event.key !== Core.PREFIX + currentUid()) return;
    calendarData = null;
    updateViews();
    if (event.key === Core.SETTINGS_KEY) refreshHistory();
  }
  function connect() {
    try {
      if (!connection) {
        if (!requireFn) requireFn = Adapter.captureRequire(window);
        const tool = Adapter.findTool(requireFn);
        if (tool) connection = Adapter.attach(tool, archive, { status, calendar: true });
      }
      if (connection) scheduleCalendar();
    } catch (error) {
      status("error", { message: String(error.message || error) });
    }
  }
  function start() {
    if (picker) return;
    picker = Calendar.createCalendar({ document, window, dateKey: Core.dateKey,
      today: () => Core.recommendationDate(new Date()),
      choose: async date => {
        if (!connection) return false;
        try { return await connection.selectDate(date); }
        finally { scheduleCalendar(); }
      }
    });
    observer = new MutationObserver(scheduleCalendar);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", onStorage);
    connect();
    timer = setInterval(connect, 2500);
  }
  globalThis[INSTANCE] = {
    dispose() {
      if (timer) clearInterval(timer);
      if (observer) observer.disconnect();
      if (calendarUpdate != null) window.clearTimeout(calendarUpdate);
      window.removeEventListener("storage", onStorage);
      if (picker) picker.dispose();
      if (connection) connection.dispose();
      const badge = document.getElementById("bncm-daily-history-note");
      if (badge) badge.remove();
      configViews.clear();
    },
    diagnostics() { return { version: "2.2", connected: !!connection, message, error: lastError,
      path: connection ? connection.history.location.pathname : location.pathname,
      localDates: archive.dates(currentUid()), client: "3.1.42 adapter" }; }
  };
  plugin.onLoad(start);
  plugin.onConfig(config);
})();

