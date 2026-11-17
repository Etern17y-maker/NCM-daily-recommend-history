(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BNCMDailyHistoryCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function monthCells(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0).getDate();
    return [...Array(first.getDay()).fill(null),
      ...Array.from({ length: last }, (_, i) => new Date(year, month, i + 1))];
  }
  const css = `
    .dh-native-tabs[role="tablist"] { display:none !important }
    .dh-calendar-bar { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin:4px 0 12px; }
    .dh-calendar-bar button, .dh-calendar button {
      appearance:none; color:inherit; background:none; border:0; font:inherit; cursor:pointer;
    }
    .dh-calendar-bar button { padding:6px 10px; border-radius:6px; display:inline-flex; align-items:center; gap:7px; }
    .dh-calendar-bar button[aria-pressed="true"] { background:rgba(236,65,65,.12); color:#ec4141; font-weight:bold; }
    .dh-calendar-bar button:hover { background:rgba(128,128,128,.12); }
    .dh-calendar { position:fixed; z-index:2147483600; box-sizing:border-box; width:284px; max-width:calc(100vw - 16px);
      max-height:calc(100vh - 16px); overflow:auto; padding:12px; border-radius:8px;
      --dh-surface:#fff; --dh-text:#313138; --dh-muted:#686871; --dh-border:#e8e8ec;
      --dh-hover:#f3f3f5; --dh-saved:#fce8e8; --dh-saved-text:#b82d37; --dh-accent:#cf343e;
      font:13px/1.4 "Microsoft YaHei UI",system-ui,sans-serif; background:var(--dh-surface);
      color:var(--dh-text); border:1px solid var(--dh-border); box-shadow:0 7px 23px rgba(0,0,0,.16); }
    .dh-calendar.dh-dark {
      color-scheme:dark; --dh-surface:#27272b; --dh-text:#e7e7eb; --dh-muted:#a1a1aa; --dh-border:#38383e;
      --dh-hover:#39393f; --dh-saved:#493137; --dh-saved-text:#ffa4a8; --dh-accent:#c9323e; }
    .dh-calendar .dh-month { display:grid; grid-template-columns:24px 24px minmax(0,1fr) 24px 24px; align-items:center;
      text-align:center; gap:2px; margin-bottom:8px; }
    .dh-calendar .dh-month button { font-size:19px; height:28px; padding:0; border-radius:5px; color:var(--dh-muted); }
    .dh-calendar .dh-selectors { display:flex; justify-content:center; gap:4px; min-width:0; }
    .dh-calendar .dh-selectors button, .dh-calendar .dh-panel-title { font-size:13px; font-weight:600; color:inherit; padding:0 5px; white-space:nowrap; }
    .dh-calendar .dh-panel-header { grid-template-columns:28px minmax(0,1fr) 28px; border-bottom:1px solid var(--dh-border); padding-bottom:8px; }
    .dh-calendar .dh-panel-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px 4px; padding:6px 0; }
    .dh-calendar .dh-panel-grid button { height:34px; border-radius:20px; padding:0 3px; white-space:nowrap; }
    .dh-calendar .dh-panel-grid button[aria-pressed="true"] { background:var(--dh-accent); color:#fff; }
    .dh-calendar button:focus-visible { outline:2px solid var(--dh-accent); outline-offset:1px; }
    .dh-calendar .dh-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:2px; text-align:center; justify-items:center; }
    .dh-calendar .dh-week { color:var(--dh-muted); padding:5px 0; }
    .dh-calendar .dh-day { width:30px; height:30px; border-radius:50%; padding:0; }
    .dh-calendar button:not(:disabled):not([aria-pressed="true"]):not([data-saved="true"]):hover { background:var(--dh-hover); }
    .dh-calendar .dh-day[data-saved="true"] { background:var(--dh-saved); color:var(--dh-saved-text); }
    .dh-calendar .dh-day[aria-pressed="true"] { background:var(--dh-accent); color:#fff; }
    .dh-calendar button:disabled { cursor:default; opacity:.35; }
    .dh-calendar .dh-calendar-message { margin:8px 0 0; text-align:center; color:var(--dh-muted); }
    .dh-calendar-legend { font-size:12px; opacity:.75; }
  `;
  function createCalendar({ document, window, dateKey, today, choose }) {
    const make = (tag, text, klass) => {
      const node = document.createElement(tag);
      if (text != null) node.textContent = text;
      if (klass) node.className = klass;
      return node;
    };
    function button(text, label, listener) {
      const node = make("button", text);
      node.type = "button";
      node.setAttribute("aria-label", label);
      node.addEventListener("click", listener);
      return node;
    }
    const style = make("style", css);
    document.head.appendChild(style);
    const bar = make("div", null, "dh-calendar-bar");
    bar.id = "bncm-daily-history-calendar-bar";
    const recent = make("span");
    recent.style.display = "contents";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "17");
    icon.setAttribute("height", "17");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("fill", "none");
    icon.appendChild(path);
    const label = make("span");
    const picker = button(null, "选择历史日推日期", () => popup ? close(true) : open());
    picker.setAttribute("aria-haspopup", "dialog");
    picker.setAttribute("aria-expanded", "false");
    picker.append(icon, label);
    bar.append(recent, picker);
    let data = { dates: [], saved: [], current: "" };
    let activeTabList = null, popup = null, month = null;
    let panel = "day", decade = 0;
    let picked = "", tentative = "", notice = "", revision = 0, signature = "", popupSignature = "";

    function position() {
      if (!popup) return;
      const bounds = picker.getBoundingClientRect();
      const x = Math.max(8, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - 8));
      const below = bounds.bottom + 6;
      const y = below + popup.offsetHeight <= window.innerHeight - 8
        ? below : Math.max(8, bounds.top - popup.offsetHeight - 6);
      popup.style.left = x + "px";
      popup.style.top = y + "px";
    }
    function outside(event) {
      if (popup && !popup.contains(event.target) && !picker.contains(event.target)) close(false);
    }
    function keydown(event) {
      if (event.key === "Escape" && popup) {
        event.stopPropagation();
        if (panel === "day") close(true);
        else showPanel("day", panel === "year" ? "选择年份" : "选择月份");
      }
    }
    function close(focus) {
      revision++;
      if (!popup) return;
      popup.remove();
      popup = null;
      picker.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (focus && bar.isConnected) picker.focus();
    }
    function open() {
      const start = (picked || data.current || today()).split("-").map(Number);
      month = new Date(start[0], start[1] - 1, 1);
      panel = "day";
      tentative = picked || data.current;
      notice = "";
      popup = make("div", null, "dh-calendar");
      const rgb = window.getComputedStyle(bar).color.match(/\d+(?:\.\d+)?/g);
      if (rgb && rgb.slice(0, 3).map(Number).reduce((sum, v) => sum + v, 0) > 390) popup.classList.add("dh-dark");
      popup.setAttribute("role", "dialog");
      popup.setAttribute("aria-label", "历史日推日历");
      popup.tabIndex = -1;
      document.body.appendChild(popup);
      picker.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", keydown, true);
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      renderPopup();
      popup.focus();
    }
    async function selectFromCalendar(date) {
      tentative = date;
      const ticket = ++revision;
      if (!data.dates.includes(date)) {
        notice = "这一天没有日推记录";
        renderPopup(date);
        return;
      }
      notice = "正在读取日推…";
      renderPopup(date);
      try {
        const ok = await choose(date);
        if (ticket !== revision) return;
        if (!ok) throw new Error("这一天的日推暂时无法读取");
        picked = date;
        renderBar();
        close(true);
      } catch (_) {
        if (ticket !== revision) return;
        notice = "这一天的日推暂时无法读取";
        renderPopup(date);
      }
    }
    function showPanel(next, focusLabel) {
      panel = next;
      notice = "";
      if (next === "year") decade = Math.floor(month.getFullYear() / 10) * 10;
      renderPopup();
      focusControl(focusLabel);
    }
    function focusControl(label) {
      const control = popup.querySelector(`[aria-label="${label}"]`);
      if (control && !control.disabled) control.focus();
      else popup.focus();
    }
    function renderPopup(focusDate) {
      if (!popup) return;
      const year = month.getFullYear(), index = month.getMonth();
      const known = new Set(data.saved);
      const available = new Set(data.dates);
      const latest = today();
      const [latestYear, latestMonth] = latest.split("-").map(Number);
      if (panel !== "day") {
        renderSelectionPanel(year, index, latestYear, latestMonth);
        return;
      }
      const monthHeader = make("div", null, "dh-month");
      function goTo(newYear, newIndex, focusLabel) {
        month = new Date(newYear, newIndex, 1);
        notice = "";
        renderPopup();
        focusControl(focusLabel);
      }
      const move = (months, glyph, title) => button(glyph, title, () => {
        goTo(year, index + months, title);
      });
      const prevYear = move(-12, "«", "上一年");
      const prevMonth = move(-1, "‹", "上个月");
      const nextMonth = move(1, "›", "下个月");
      const nextYear = move(12, "»", "下一年");
      prevYear.disabled = year <= 1900;
      prevMonth.disabled = year <= 1900 && index === 0;
      nextMonth.disabled = dateKey(new Date(year, index + 1, 1)).slice(0, 7) > latest.slice(0, 7);
      nextYear.disabled = dateKey(new Date(year + 1, index, 1)).slice(0, 7) > latest.slice(0, 7);
      const selectors = make("div", null, "dh-selectors");
      selectors.append(
        button(year + "年", "选择年份", () => showPanel("year", year + "年")),
        button(index + 1 + "月", "选择月份", () => showPanel("month", index + 1 + "月"))
      );
      monthHeader.append(prevYear, prevMonth, selectors, nextMonth, nextYear);
      const grid = make("div", null, "dh-grid");
      for (const week of "日一二三四五六") grid.appendChild(make("span", week, "dh-week"));
      let focusTarget;
      for (const day of monthCells(year, index)) {
        if (!day) { grid.appendChild(make("span")); continue; }
        const date = dateKey(day);
        const hint = known.has(date) ? "已保存" : available.has(date) ? "官方历史可读取" : "无本地记录";
        const node = button(String(day.getDate()), date + " " + hint, () => selectFromCalendar(date));
        node.className = "dh-day";
        node.dataset.saved = String(known.has(date));
        node.setAttribute("aria-pressed", String(date === tentative));
        if (date === latest) node.setAttribute("aria-current", "date");
        node.disabled = date > latest && !available.has(date);
        grid.appendChild(node);
        if (date === focusDate) focusTarget = node;
      }
      popup.textContent = "";
      popup.append(monthHeader, grid);
      if (notice) {
        const message = make("p", notice, "dh-calendar-message");
        message.setAttribute("role", "status");
        popup.appendChild(message);
      }
      position();
      if (focusTarget) focusTarget.focus();
    }
    function renderSelectionPanel(year, index, latestYear, latestMonth) {
      const yearPanel = panel === "year";
      const header = make("div", null, "dh-month dh-panel-header");
      const move = (direction, title) => button(direction < 0 ? "«" : "»", title, () => {
        if (yearPanel) decade += direction * 10;
        else {
          const destination = year + direction;
          month = new Date(destination, destination === latestYear ? Math.min(index, latestMonth - 1) : index, 1);
        }
        renderPopup();
        focusControl(title);
      });
      const previous = move(-1, yearPanel ? "上一个十年" : "上一年");
      const next = move(1, yearPanel ? "下一个十年" : "下一年");
      previous.disabled = yearPanel ? decade <= 1900 : year <= 1900;
      next.disabled = yearPanel ? decade + 10 > latestYear : year >= latestYear;
      const title = yearPanel
        ? make("strong", `${decade}年 – ${decade + 9}年`, "dh-panel-title")
        : button(year + "年", "切换到年份选择", () => showPanel("year", year + "年"));
      title.classList.add("dh-panel-title");
      header.append(previous, title, next);
      const grid = make("div", null, "dh-panel-grid");
      for (let i = 0; i < (yearPanel ? 10 : 12); i++) {
        const value = yearPanel ? decade + i : i + 1;
        const label = value + (yearPanel ? "年" : "月");
        const node = button(label, label, () => {
          if (yearPanel) {
            const selectedIndex = value === latestYear ? Math.min(index, latestMonth - 1) : index;
            month = new Date(value, selectedIndex, 1);
            showPanel("month", selectedIndex + 1 + "月");
          } else {
            month = new Date(year, value - 1, 1);
            showPanel("day", "选择月份");
          }
        });
        node.disabled = yearPanel ? value > latestYear : year === latestYear && value > latestMonth;
        node.setAttribute("aria-pressed", String(yearPanel ? value === year : i === index));
        grid.appendChild(node);
      }
      popup.textContent = "";
      popup.append(header, grid);
      position();
    }
    function renderBar() {
      const dates = data.dates.slice(0, 5);
      const key = JSON.stringify([dates, data.current, picked]);
      if (key === signature) return;
      signature = key;
      recent.textContent = "";
      const feedback = make("span", "", "dh-calendar-legend");
      feedback.setAttribute("role", "status");
      for (const date of dates) {
        const node = button(date.slice(5).replace("-", "."), date, async () => {
          const failure = "这一天的日推暂时无法读取";
          try { if (!await choose(date)) feedback.textContent = failure; }
          catch (_) { feedback.textContent = failure; }
        });
        node.setAttribute("aria-pressed", String(date === data.current));
        recent.appendChild(node);
      }
      recent.appendChild(feedback);
      label.textContent = picked;
      label.hidden = !picked;
      picker.setAttribute("aria-pressed", String(!!picked && picked === data.current && !dates.includes(picked)));
    }
    function update(next, tabList, fallback) {
      if (next.owner !== data.owner) {
        close(false);
        picked = "";
      }
      data = next;
      if (picked && !data.dates.includes(picked)) picked = "";
      if (activeTabList !== tabList) {
        if (activeTabList) activeTabList.classList.remove("dh-native-tabs");
        activeTabList = tabList;
      }
      if (tabList) {
        if (bar.nextElementSibling !== tabList) tabList.insertAdjacentElement("beforebegin", bar);
        tabList.classList.add("dh-native-tabs");
      } else if (fallback) {
        if (bar.previousElementSibling !== fallback) fallback.insertAdjacentElement("afterend", bar);
      } else {
        close(false);
        bar.remove();
        return;
      }
      renderBar();
      const key = JSON.stringify([data.dates, data.saved]);
      if (popup && key !== popupSignature) renderPopup();
      popupSignature = key;
    }
    function dispose() {
      close(false);
      if (activeTabList) activeTabList.classList.remove("dh-native-tabs");
      style.remove();
      bar.remove();
    }
    return { update, dispose };
  }
  return { monthCells, createCalendar };
});

