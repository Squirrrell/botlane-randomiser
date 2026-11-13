(function () {
  "use strict";

  const DDRAGON = "https://ddragon.leagueoflegends.com";
  const STORE_KEY = "botlane-randomiser:v1";
  const THEME_KEY = "botlane-randomiser:theme";
  const HISTORY_MAX = 6;

  const ROLES = [
    { key: "top", label: "Top", icon: "assets/roles/top.png" },
    { key: "jungle", label: "Jungle", icon: "assets/roles/jungle.png" },
    { key: "mid", label: "Mid", icon: "assets/roles/middle.png" },
    { key: "bot", label: "Bot", icon: "assets/roles/bottom.png" },
    { key: "support", label: "Support", icon: "assets/roles/utility.png" },
  ];
  const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    version: null,
    champions: [],
    byId: {},
    offMeta: true,
    rolling: false,
    history: [],
    slots: {
      bot: { lane: "bot", pool: new Set(["top", "jungle", "mid", "support"]), locked: false, current: null },
      support: { lane: "support", pool: new Set(["top", "jungle", "mid", "bot"]), locked: false, current: null },
    },
  };

  /* ---------- DOM ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const stage = $("#stage");
  const rollBtn = $("#roll");
  const rollLabel = $("#roll-label");
  const offMetaInput = $("#offmeta");
  const statusEl = $("#status");
  const announceEl = $("#announce");
  const patchEl = $("#patch");
  const historyList = $("#history-list");
  const historyEmpty = $("#history-empty");
  const historyClear = $("#history-clear");

  const slotEls = {};
  for (const key of Object.keys(state.slots)) {
    const root = $(`.slot[data-slot="${key}"]`);
    slotEls[key] = {
      root,
      picker: $("[data-picker]", root),
      count: $("[data-pool-count]", root),
      card: $("[data-card]", root),
      art: $("[data-art]", root),
      spinName: $("[data-spin-name]", root),
      name: $("[data-name]", root),
      usual: $("[data-usual]", root),
      lock: $("[data-lock]", root),
      backdrop: $(`[data-backdrop="${key}"]`),
    };
  }

  /* ---------- storage ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.offMeta === "boolean") state.offMeta = saved.offMeta;
      for (const key of Object.keys(state.slots)) {
        const pool = saved.pools && saved.pools[key];
        if (Array.isArray(pool)) {
          const valid = pool.filter((r) => ROLE_BY_KEY[r]);
          if (valid.length) state.slots[key].pool = new Set(valid);
        }
      }
      if (Array.isArray(saved.history)) state.history = saved.history.slice(0, HISTORY_MAX);
    } catch (e) {
      /* storage blocked or corrupt: run with defaults */
    }
  }

  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          offMeta: state.offMeta,
          pools: Object.fromEntries(Object.entries(state.slots).map(([k, s]) => [k, [...s.pool]])),
          history: state.history,
        })
      );
    } catch (e) {}
  }

  /* ---------- data ---------- */

  async function fetchChampions() {
    const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => {
      if (!r.ok) throw new Error("versions " + r.status);
      return r.json();
    });
    const version = versions[0];
    const data = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`).then((r) => {
      if (!r.ok) throw new Error("champions " + r.status);
      return r.json();
    });
    const champions = Object.values(data.data)
      .map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        roles: window.CHAMPION_ROLES[c.id] || window.guessRoles(c.tags),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { version, champions };
  }

  const artUrl = (id) => `${DDRAGON}/cdn/img/champion/loading/${id}_0.jpg`;
  const splashUrl = (id) => `${DDRAGON}/cdn/img/champion/splash/${id}_0.jpg`;
  const iconUrl = (id) => `${DDRAGON}/cdn/${state.version}/img/champion/${id}.png`;

  /* ---------- pools ---------- */

  /*
   * A champion is in a slot's pool if any of its usual roles is switched on.
   * Off-meta only also drops champions who already play the slot's lane,
   * unless the player has switched that lane's own role on for the slot.
   */
  function poolFor(slotKey) {
    const slot = state.slots[slotKey];
    const skipMeta = state.offMeta && !slot.pool.has(slot.lane);
    return state.champions.filter(
      (c) => c.roles.some((r) => slot.pool.has(r)) && !(skipMeta && c.roles.includes(slot.lane))
    );
  }

  /* ---------- rendering ---------- */

  function buildPickers() {
    for (const [key, els] of Object.entries(slotEls)) {
      els.picker.innerHTML = "";
      for (const role of ROLES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "role-btn";
        btn.dataset.role = role.key;
        btn.innerHTML = `<img src="${role.icon}" alt="" width="30" height="30"><span>${role.label}</span>`;
        btn.addEventListener("click", () => toggleRole(key, role.key));
        els.picker.appendChild(btn);
      }
    }
  }

  function renderPickers() {
    for (const [key, els] of Object.entries(slotEls)) {
      const slot = state.slots[key];
      const count = state.champions.length ? poolFor(key).length : null;
      for (const btn of els.picker.children) {
        const role = btn.dataset.role;
        const on = slot.pool.has(role);
        btn.setAttribute("aria-pressed", String(on));
        btn.disabled = state.rolling;
        btn.title = `${on ? "Remove" : "Add"} ${ROLE_BY_KEY[role].label} champions`;
      }
      if (count === null) {
        els.count.textContent = "";
      } else {
        els.count.textContent = `Rolls from ${count} ${count === 1 ? "champion" : "champions"}`;
        els.count.classList.toggle("is-empty", count === 0);
      }
      els.root.classList.toggle("is-empty-pool", count === 0);
    }
  }

  function renderResult(slotKey) {
    const els = slotEls[slotKey];
    const slot = state.slots[slotKey];
    const champ = slot.current && state.byId[slot.current];

    els.lock.disabled = !champ || state.rolling;
    els.lock.setAttribute("aria-pressed", String(slot.locked));
    els.lock.querySelector("i").className = slot.locked ? "ph-bold ph-lock-simple" : "ph ph-lock-simple-open";
    els.lock.querySelector("span").textContent = slot.locked ? "Locked" : "Lock";
    els.lock.setAttribute("aria-label", champ ? `${slot.locked ? "Unlock" : "Lock"} ${champ.name}` : "Lock");
    els.root.classList.toggle("is-locked", slot.locked);

    if (!champ) {
      els.name.innerHTML = "&nbsp;";
      els.usual.innerHTML = "";
      return;
    }
    els.name.textContent = champ.name;
    const usual = champ.roles
      .map((r) => `<img src="${ROLE_BY_KEY[r].icon}" alt="${ROLE_BY_KEY[r].label}" title="${ROLE_BY_KEY[r].label}" width="16" height="16">`)
      .join("");
    els.usual.innerHTML = `<span>Normally plays</span>${usual}`;
  }

  function renderControls() {
    const anyRollable = Object.keys(state.slots).some(
      (k) => !state.slots[k].locked && poolFor(k).length > 0
    );
    rollBtn.disabled = state.rolling || !state.champions.length || !anyRollable;
    if (!state.champions.length) return;
    const bothLocked = Object.values(state.slots).every((s) => s.locked);
    rollLabel.textContent = state.rolling ? "Rolling" : bothLocked ? "Both locked" : "Roll";
    offMetaInput.checked = state.offMeta;
    offMetaInput.disabled = state.rolling;
  }

  function renderHistory() {
    historyList.innerHTML = "";
    historyEmpty.hidden = state.history.length > 0;
    historyClear.hidden = state.history.length === 0;
    for (const entry of state.history) {
      const a = state.byId[entry.bot];
      const b = state.byId[entry.support];
      if (!a || !b) continue;
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <img src="${iconUrl(a.id)}" alt="" width="36" height="36" loading="lazy">
        <img src="${iconUrl(b.id)}" alt="" width="36" height="36" loading="lazy">
        <span class="history-names"><span>${a.name}</span><span>${b.name}</span></span>`;
      li.setAttribute("aria-label", `${a.name} bot, ${b.name} support`);
      historyList.appendChild(li);
    }
  }

  function renderAll() {
    renderPickers();
    renderControls();
    Object.keys(state.slots).forEach(renderResult);
  }

  /* ---------- interactions ---------- */

  function toggleRole(slotKey, role) {
    if (state.rolling) return;
    const pool = state.slots[slotKey].pool;
    if (pool.has(role)) pool.delete(role);
    else pool.add(role);
    save();
    renderPickers();
    renderControls();
  }

  function toggleLock(slotKey) {
    const slot = state.slots[slotKey];
    if (!slot.current || state.rolling) return;
    slot.locked = !slot.locked;
    renderResult(slotKey);
    renderControls();
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function chooseFor(slotKey, taken) {
    const slot = state.slots[slotKey];
    let options = poolFor(slotKey).filter((c) => !taken.has(c.id));
    // Avoid handing back the same champion twice in a row when there's a choice.
    if (options.length > 1 && slot.current) options = options.filter((c) => c.id !== slot.current);
    return options.length ? pick(options) : null;
  }

  function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = () => resolve(img);
      img.onload = done;
      img.onerror = done;
      img.src = src;
      setTimeout(done, 4000);
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Slide the champion's splash art into the free strip beside their card.
  // Bot lane wants the champion on the left edge, support on the right, so
  // art is mirrored when the champion faces the wrong side of the picture.
  function setBackdrop(slotKey, id) {
    const el = slotEls[slotKey].backdrop;
    const fx = (window.SPLASH_FOCUS && window.SPLASH_FOCUS[id]) || 0.6;
    const flip = slotKey === "bot" ? fx >= 0.5 : fx < 0.5;
    el.style.setProperty("--splash", `url("${splashUrl(id)}")`);
    el.style.setProperty("--fx", String(fx));
    el.style.setProperty("--edge", String(Math.max(0.05, Math.min(fx, 1 - fx))));
    el.style.setProperty("--t", fx < 0.5 ? "9vw" : "41vw");
    el.classList.toggle("is-flipped", flip);
    el.classList.add("is-visible");
  }

  async function spin(slotKey, finalChamp, delay) {
    const els = slotEls[slotKey];
    const pool = poolFor(slotKey);
    const imgReady = preload(artUrl(finalChamp.id));

    if (!reduceMotion.matches) {
      await wait(delay);
      els.card.dataset.state = "spinning";
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        els.spinName.textContent = pick(pool).name;
        // Ease out: quick flicker at first, slowing down near the end.
        const t = i / steps;
        await wait(38 + 190 * t * t);
      }
      els.spinName.textContent = finalChamp.name;
    }
    await imgReady;

    els.art.src = artUrl(finalChamp.id);
    els.art.alt = `${finalChamp.name} loading screen art`;
    els.card.dataset.state = "revealed";
    setBackdrop(slotKey, finalChamp.id);
  }

  async function roll() {
    if (state.rolling || !state.champions.length) return;

    const taken = new Set();
    for (const [k, s] of Object.entries(state.slots)) if (s.locked && s.current) taken.add(s.current);

    const plan = {};
    for (const key of Object.keys(state.slots)) {
      if (state.slots[key].locked) continue;
      const champ = chooseFor(key, taken);
      if (champ) {
        plan[key] = champ;
        taken.add(champ.id);
      }
    }
    if (!Object.keys(plan).length) return;

    state.rolling = true;
    statusEl.textContent = "";
    stage.dataset.rolling = "true";
    renderAll();

    await Promise.all(
      Object.entries(plan).map(([key, champ], i) => {
        state.slots[key].current = champ.id;
        return spin(key, champ, i * 140);
      })
    );

    state.rolling = false;
    delete stage.dataset.rolling;

    const bot = state.slots.bot.current;
    const sup = state.slots.support.current;
    if (bot && sup) {
      const last = state.history[0];
      if (!last || last.bot !== bot || last.support !== sup) {
        state.history.unshift({ bot, support: sup });
        state.history = state.history.slice(0, HISTORY_MAX);
      }
      announceEl.textContent = `${state.byId[bot].name} bot, ${state.byId[sup].name} support.`;
    }
    save();
    renderAll();
    renderHistory();
  }

  /* ---------- theme ---------- */

  function currentTheme() {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function syncThemeButton() {
    const btn = $("#theme-toggle");
    const theme = currentTheme();
    btn.querySelector("i").className = theme === "dark" ? "ph ph-sun" : "ph ph-moon";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  $("#theme-toggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    syncThemeButton();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncThemeButton);

  /* ---------- wiring ---------- */

  rollBtn.addEventListener("click", roll);
  offMetaInput.addEventListener("change", () => {
    state.offMeta = offMetaInput.checked;
    save();
    renderAll();
  });
  for (const [key, els] of Object.entries(slotEls)) {
    els.lock.addEventListener("click", () => toggleLock(key));
  }
  historyClear.addEventListener("click", () => {
    state.history = [];
    save();
    renderHistory();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "r" && e.key !== "R") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    roll();
  });

  async function init() {
    load();
    buildPickers();
    syncThemeButton();
    renderAll();
    renderHistory();
    stage.dataset.state = "loading";
    rollLabel.textContent = "Loading";
    statusEl.textContent = "";

    try {
      const { version, champions } = await fetchChampions();
      state.version = version;
      state.champions = champions;
      state.byId = Object.fromEntries(champions.map((c) => [c.id, c]));
      state.history = state.history.filter((h) => state.byId[h.bot] && state.byId[h.support]);
      patchEl.textContent = `Patch ${version.split(".").slice(0, 2).join(".")}`;
      patchEl.hidden = false;
      stage.dataset.state = "ready";
      renderAll();
      renderHistory();
    } catch (err) {
      stage.dataset.state = "error";
      rollLabel.textContent = "Offline";
      statusEl.innerHTML = "";
      const msg = document.createElement("span");
      msg.textContent = "Couldn't load the champion list from Riot. ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-btn";
      retry.textContent = "Try again";
      retry.addEventListener("click", init);
      statusEl.append(msg, retry);
    }
  }

  init();
})();
