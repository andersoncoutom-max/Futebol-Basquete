/* global html2canvas */

const state = {
  dataset: "fc25",
  preset: "",
  participants: [],
  lastRemoved: null,
  lastDraw: null,
  resultView: "cards",
  room: { code: "", url: "" },
};

const bracketState = {
  rounds: [],
  pendingByes: [],
};

const BUILTIN_PRESETS = {
  fc_quick: {
    dataset: "fc25",
    label: "Sorteio rápido",
    hero: {
      kicker: "EA FC 25",
      title: "Sorteio FC",
      subtitle: "Adicione os jogadores e sorteie times na hora.",
    },
    defaults: { category: "clubs_men" },
    filters: {},
  },
  fc_selecoes: {
    dataset: "fc25",
    label: "Seleções (masculino)",
    hero: {
      kicker: "EA FC 25",
      title: "Seleções em foco",
      subtitle: "Sorteie seleções e monte confrontos rápidos.",
    },
    defaults: { category: "national_men", mode: "national" },
    filters: { team_types: ["NATIONAL"], genders: ["MEN"] },
  },
  fc_classicos: {
    dataset: "fc25",
    label: "Clássicos (clubes)",
    hero: {
      kicker: "EA FC 25",
      title: "Clássicos e rivalidades",
      subtitle: "Clubes masculinos e confronto direto.",
    },
    defaults: { category: "clubs_men", mode: "clubs" },
    filters: { team_types: ["CLUB"], genders: ["MEN"] },
  },
  nba_quick: {
    dataset: "nba",
    label: "Sorteio rápido",
    hero: {
      kicker: "NBA 2K25",
      title: "Sorteio NBA",
      subtitle: "Escolha os jogadores e sorteie franquias.",
    },
    defaults: { category: "all" },
    filters: {},
  },
  nba_playoffs: {
    dataset: "nba",
    label: "Playoffs (times fortes)",
    hero: {
      kicker: "NBA 2K25",
      title: "Playoffs NBA",
      subtitle: "Chave direto com clima de mata-mata.",
    },
    defaults: { category: "all", format: "bracket" },
    filters: {},
  },
  nba_east: {
    dataset: "nba",
    label: "Conferência Leste",
    hero: {
      kicker: "NBA 2K25",
      title: "Conferência Leste",
      subtitle: "Só times do Leste.",
    },
    defaults: { category: "east" },
    filters: { conferences: ["Eastern"] },
  },
  nba_west: {
    dataset: "nba",
    label: "Conferência Oeste",
    hero: {
      kicker: "NBA 2K25",
      title: "Conferência Oeste",
      subtitle: "Só times do Oeste.",
    },
    defaults: { category: "west" },
    filters: { conferences: ["Western"] },
  },
};

let PRESETS = { ...BUILTIN_PRESETS };

function poolToPreset(dataset, pool) {
  const label = String(pool.label || "").trim() || "Preset";
  const title = label;
  const subtitle = String(pool.description || "").trim() || "Seleção pronta de times.";
  const kicker = dataset === "nba" ? "NBA 2K25" : "EA FC 25";

  return {
    dataset,
    label,
    hero: { kicker, title, subtitle },
    defaults: pool.defaults || {},
    filters: { include_team_ids: pool.include_team_ids || [] },
  };
}

function mergePools(pools) {
  if (!pools || typeof pools !== "object") return;

  const next = { ...BUILTIN_PRESETS };
  ["fc25", "nba"].forEach((dataset) => {
    const list = pools[dataset];
    if (!Array.isArray(list)) return;
    list.forEach((pool) => {
      const key = String(pool?.key || "").trim();
      if (!key) return;
      next[`pool_${dataset}_${key}`] = poolToPreset(dataset, pool);
    });
  });
  PRESETS = next;
}

async function loadRemotePools() {
  try {
    const res = await fetch("/api/pools");
    if (!res.ok) return;
    const pools = await res.json();
    mergePools(pools);
  } catch {
    // sem pools remotos
  }
}

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function showError(message) {
  const box = $("errorBox");
  if (!box) return;
  box.textContent = message;
  box.classList.remove("d-none");
}

function clearError() {
  const box = $("errorBox");
  if (!box) return;
  box.textContent = "";
  box.classList.add("d-none");
}

function normalizeName(name) {
  return String(name || "").trim();
}

function uniqueCaseInsensitive(values) {
  const seen = new Set();
  const out = [];
  values.forEach((v) => {
    const clean = normalizeName(v);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function setStorageBool(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

function getStorageBool(key, fallback = false) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

function announce(message) {
  const live = $("statusAnnouncer");
  if (live) live.textContent = message;
}

function storageKey(name) {
  return `${name}_${state.dataset}`;
}

async function copyTextWithFallback(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // tenta fallback
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function categoryLabel(row, dataset = state.dataset) {
  const teamType = String(row.team_type || "").toUpperCase();
  const gender = String(row.gender || "").toUpperCase();
  if (dataset === "nba") return "NBA";
  if (teamType === "NATIONAL" && gender === "WOMEN") return "Seleções femininas";
  if (teamType === "NATIONAL" && gender === "MEN") return "Seleções masculinas";
  if (teamType === "CLUB" && gender === "WOMEN") return "Clubes femininos";
  if (teamType === "CLUB" && gender === "MEN") return "Clubes masculinos";
  if (teamType === "NATIONAL") return "Seleções";
  return "Clubes";
}

function badgeText(value) {
  const clean = String(value || "").trim();
  if (!clean) return "SF";
  const parts = clean.split(/\\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hashString(value) {
  let hash = 0;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function badgeColors(value) {
  const h = hashString(value) % 360;
  return {
    solid: `hsl(${h} 70% 55%)`,
    soft: `hsla(${h} 70% 55% / 0.18)`,
  };
}

function applyThemeMode(mode) {
  document.body.classList.toggle("theme-dark", mode === "dark");
  const btn = $("themeToggleBtn");
  if (btn) btn.textContent = mode === "dark" ? "Tema claro" : "Tema escuro";
}

function setDataset(dataset) {
  state.dataset = dataset;
  document.body.classList.toggle("theme-nba", dataset === "nba");

  $("datasetFc25Btn")?.classList.toggle("active", dataset === "fc25");
  $("datasetNbaBtn")?.classList.toggle("active", dataset === "nba");

  fillPresetsForDataset(dataset);
  updateCategoryOptions(dataset);
  resetResults();
}

function updateCategoryOptions(dataset) {
  const select = $("categorySelect");
  if (!select) return;

  const previous = select.value;
  const options = [];

  if (dataset === "nba") {
    options.push({ value: "all", label: "Todos" });
    options.push({ value: "east", label: "Leste" });
    options.push({ value: "west", label: "Oeste" });
  } else {
    options.push({ value: "all", label: "Todos" });
    options.push({ value: "clubs_men", label: "Clubes masculinos" });
    options.push({ value: "national_men", label: "Seleções masculinas" });
    options.push({ value: "clubs_women", label: "Clubes femininos" });
    options.push({ value: "national_women", label: "Seleções femininas" });
  }

  select.innerHTML = "";
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  });

  if (previous && options.some((o) => o.value === previous)) {
    select.value = previous;
  } else {
    select.value = dataset === "nba" ? "all" : "clubs_men";
  }
}

function toggleTopN() {
  const modeSelect = $("modeSelect");
  const topWrap = $("topNWrap");
  if (!modeSelect || !topWrap) return;
  topWrap.classList.toggle("d-none", modeSelect.value !== "top");
}

function fillPresetsForDataset(dataset) {
  const select = $("presetSelect");
  if (!select) return;

  const options = Object.entries(PRESETS)
    .filter(([, p]) => p.dataset === dataset)
    .map(([key, p]) => ({ key, label: p.label }));

  select.innerHTML = "";
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.key;
    o.textContent = opt.label;
    select.appendChild(o);
  });

  const fallback = options[0]?.key || "";
  const want = state.preset && options.some((o) => o.key === state.preset) ? state.preset : fallback;
  select.value = want;
  applyPreset(want);
}

function applyPreset(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return;
  state.preset = presetId;

  if (preset.hero) {
    setText("heroKicker", preset.hero.kicker || "");
    setText("heroTitle", preset.hero.title || "");
    setText("heroSubtitle", preset.hero.subtitle || "");
  }

  const modeSelect = $("modeSelect");
  const categorySelect = $("categorySelect");
  const formatSelect = $("formatSelect");

  if (preset.defaults?.mode && modeSelect) modeSelect.value = preset.defaults.mode;
  if (preset.defaults?.category && categorySelect) categorySelect.value = preset.defaults.category;
  if (preset.defaults?.format && formatSelect) formatSelect.value = preset.defaults.format;

  toggleTopN();
}

function renderParticipants() {
  setText("participantTitle", `Jogadores (${state.participants.length})`);
  const list = $("participantsList");
  if (!list) return;
  list.innerHTML = "";

  state.participants.forEach((name) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;

    const removeSpan = document.createElement("span");
    removeSpan.className = "remove";
    removeSpan.title = "Remover";
    removeSpan.setAttribute("aria-label", `Remover ${name}`);
    removeSpan.textContent = "×";

    removeSpan.addEventListener("click", () => {
      state.lastRemoved = name;
      state.participants = state.participants.filter((p) => p !== name);
      renderParticipants();
    });

    chip.appendChild(nameSpan);
    chip.appendChild(removeSpan);
    list.appendChild(chip);
  });
  setDrawEnabled();
}

function updateBulkFeedback(text) {
  const feedback = $("bulkFeedback");
  if (!feedback) return;
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((s) => normalizeName(s))
    .filter(Boolean);

  const unique = uniqueCaseInsensitive(lines);
  const dupes = Math.max(0, lines.length - unique.length);
  feedback.textContent = lines.length ? `${lines.length} nomes detectados · ${dupes} duplicados` : "";
}

function setResultView(view) {
  state.resultView = view;
  const cards = $("resultCards");
  const tableWrap = $("resultTableWrap");
  const toggleBtn = $("toggleViewBtn");
  if (cards) cards.classList.toggle("d-none", view === "table");
  if (tableWrap) tableWrap.classList.toggle("d-none", view !== "table");
  if (toggleBtn) toggleBtn.textContent = view === "table" ? "Ver cards" : "Ver tabela";
}

function setActionButtons(enabled) {
  [
    "toggleViewBtn",
    "shareOpenBtn",
    "shareWhatsBtn",
    "shareLinkBtn",
    "shareCsvBtn",
    "shareResultPngBtn",
    "shareBracketPngBtn",
    "swapHomeBtn",
    "generateBracketBtn",
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !enabled;
  });
}

function resetResults() {
  state.lastDraw = null;
  $("resultsPanel")?.classList.add("d-none");
  $("bracketSection")?.classList.add("d-none");
  $("shareSection")?.classList.add("d-none");
  setActionButtons(false);
  setResultView("cards");

  const cards = $("resultCards");
  if (cards) cards.innerHTML = "";
  const tbody = $("resultTbody");
  if (tbody) tbody.innerHTML = "";
  const meta = $("resultMeta");
  if (meta) meta.textContent = "";
  setText("shareStatus", "");

  resetBracket();
  $("rrBox")?.classList.add("d-none");
}

function showResultsPanel() {
  $("resultsPanel")?.classList.remove("d-none");
  $("bracketSection")?.classList.add("d-none");
  $("shareSection")?.classList.add("d-none");
  $("resultsPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setDrawEnabled() {
  const drawBtn = $("drawBtn");
  const hint = $("drawHint");
  const emptyHint = $("emptyHint");
  const enabled = state.participants.length >= 2;
  if (drawBtn) drawBtn.disabled = !enabled;
  if (hint) hint.classList.toggle("d-none", enabled);
  if (emptyHint) emptyHint.classList.toggle("d-none", enabled);
}

function updateOptionSummary() {
  const target = $("optionSummary");
  if (!target) return;
  const format = $("formatSelect")?.value || "bracket";
  const balance = $("balanceSelect")?.value || "random";
  const mode = $("modeSelect")?.value || "all";
  const formatLabel = format === "round_robin" ? "Todos contra todos" : "Mata-mata";
  const balanceLabel = balance === "tiers" ? "Equilibrado" : "Aleatório";
  let modeLabel = "Todos";
  if (mode === "clubs") modeLabel = "Só clubes";
  if (mode === "national") modeLabel = "Só seleções";
  if (mode === "top") modeLabel = "Top N (overall)";
  target.textContent = `Formato: ${formatLabel} | Equilíbrio: ${balanceLabel} | Times: ${modeLabel}`;
}


function computeEquilibrium(drawRows) {
  const overalls = drawRows.map((r) => Number(r.overall || 0)).filter((n) => Number.isFinite(n));
  if (!overalls.length) return { avg: 0, diff: 0, label: "—" };
  const avg = Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length);
  const diff = Math.max(...overalls) - Math.min(...overalls);
  let label = "bom";
  if (diff >= 8) label = "alto";
  else if (diff >= 5) label = "médio";
  return { avg, diff, label };
}

async function copyToClipboard(text) {
  const ok = await copyTextWithFallback(text);
  if (!ok) throw new Error("Clipboard indisponível.");
}

function buildWhatsAppText(payload) {
  const drawRows = payload.draw || [];
  const lines = drawRows.map((row) => {
    const ovr = row.overall ? ` (OVR ${row.overall})` : "";
    return `• ${row.participant}: ${row.team_name}${ovr}`;
  });
  const header = `Sorteio FC — ${state.dataset === "nba" ? "NBA 2K25" : "EA FC 25"}`;
  const roomLine = state.room.code ? `Sala: ${state.room.code}` : "";
  return [header, roomLine, "", ...lines].filter(Boolean).join("\n");
}

async function copyWhatsApp() {
  if (!state.lastDraw) return;
  try {
    const ok = await copyTextWithFallback(buildWhatsAppText(state.lastDraw));
    if (ok) {
      setText("shareStatus", "Texto copiado.");
      announce("Copiado para a área de transferência.");
    } else throw new Error("copy_failed");
  } catch {
    showError("Não foi possível copiar. Verifique as permissões do navegador.");
  }
}

async function copyCsv() {
  if (!state.lastDraw) return;
  const drawRows = state.lastDraw.draw || [];
  const lines = drawRows.map((row) => {
    const label = categoryLabel(row);
    return `${row.participant};${row.team_name};${label};${row.overall ?? ""};${row.attack ?? ""};${row.midfield ?? ""};${row.defence ?? ""}`;
  });
  const text = ["PARTICIPANTE;TIME;CATEGORIA;OVR;ATT;MID;DEF", ...lines].join("\n");
  try {
    const ok = await copyTextWithFallback(text);
    if (ok) {
      setText("shareStatus", "CSV copiado.");
      announce("CSV copiado.");
    } else throw new Error("copy_failed");
  } catch {
    showError("Não foi possível copiar. Verifique as permissões do navegador.");
  }
}

async function exportPng(targetId, filename) {
  const target = $(targetId);
  if (!target || typeof html2canvas === "undefined") {
    showError("PNG indisponível no momento.");
    return;
  }
  const canvas = await html2canvas(target, { backgroundColor: null, scale: 2 });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function buildFiltersFromUI() {
  const mode = $("modeSelect")?.value || "all";
  const topN = parseInt($("topNInput")?.value || "10", 10);
  const category = $("categorySelect")?.value || "all";

  const filters = {
    mode: mode === "top" ? "top" : "all",
    top_n: Number.isFinite(topN) ? topN : 10,
    overall_min: 0,
    include_invalid: false,
  };

  if (state.dataset === "nba") {
    if (category === "east") filters.conferences = ["Eastern"];
    if (category === "west") filters.conferences = ["Western"];
  } else {
    if (category === "clubs_men") {
      filters.team_types = ["CLUB"];
      filters.genders = ["MEN"];
    } else if (category === "national_men") {
      filters.team_types = ["NATIONAL"];
      filters.genders = ["MEN"];
    } else if (category === "clubs_women") {
      filters.team_types = ["CLUB"];
      filters.genders = ["WOMEN"];
    } else if (category === "national_women") {
      filters.team_types = ["NATIONAL"];
      filters.genders = ["WOMEN"];
    }

    if (mode === "clubs") filters.team_types = ["CLUB"];
    if (mode === "national") filters.team_types = ["NATIONAL"];
  }

  const preset = PRESETS[state.preset];
  if (preset?.filters) {
    Object.entries(preset.filters).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      filters[k] = v;
    });
  }

  return filters;
}

function getExcludeTeams() {
  const avoidRepeat = Boolean($("avoidRepeatToggle")?.checked);
  const avoidRepeat3 = Boolean($("avoidRepeat3Toggle")?.checked);
  if (!avoidRepeat && !avoidRepeat3) return [];

  const history = JSON.parse(localStorage.getItem(storageKey("lastDrawTeamsHistory")) || "[]");
  const flatHistory = history.flat();
  const last = JSON.parse(localStorage.getItem(storageKey("lastDrawTeams")) || "[]");

  if (avoidRepeat3) return flatHistory;
  return last;
}

async function drawNow() {
  clearError();

  if (state.participants.length < 2) {
    showError("Adicione ao menos 2 jogadores.");
    return;
  }

  $("loadingOverlay")?.classList.add("active");

  const filters = buildFiltersFromUI();
  const balanceMode = $("balanceSelect")?.value || "random";
  const format = $("formatSelect")?.value || "bracket";
  const exclude = getExcludeTeams();

  const payload = {
    dataset: state.dataset,
    participants: state.participants,
    filters,
    balance_mode: balanceMode,
    avoid_repeat: exclude.length > 0,
    avoid_repeat_window: Boolean($("avoidRepeat3Toggle")?.checked) ? 3 : 1,
    exclude_team_ids: exclude,
  };

  let res;
  try {
    res = await fetch("/api/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    $("loadingOverlay")?.classList.remove("active");
    showError("Falha de comunicação com o servidor.");
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("loadingOverlay")?.classList.remove("active");
    showError(data.error || "Erro ao sortear.");
    return;
  }

  state.lastDraw = data;
  if (state.room.code) {
    createShareCode({ silent: true }).catch(() => {});
  }

  const used = (data.draw || []).map((r) => r.team_id).filter(Boolean);
  localStorage.setItem(storageKey("lastDrawTeams"), JSON.stringify(used));
  const hist = JSON.parse(localStorage.getItem(storageKey("lastDrawTeamsHistory")) || "[]");
  hist.unshift(used);
  localStorage.setItem(storageKey("lastDrawTeamsHistory"), JSON.stringify(hist.slice(0, 3)));

  renderResults(data, { live: Boolean($("liveModeToggle")?.checked) });
  $("loadingOverlay")?.classList.remove("active");
  showResultsPanel();

  $("bracketSection")?.classList.add("d-none");
  $("shareSection")?.classList.add("d-none");
}

function renderResults(payload, { live } = { live: false }) {
  const drawRows = payload.draw || [];
  setActionButtons(true);

  $("resultsPanel")?.classList.remove("d-none");
  $("bracketSection")?.classList.add("d-none");
  $("shareSection")?.classList.add("d-none");

  const { avg, diff, label } = computeEquilibrium(drawRows);
  const bits = [];
  if ($("balanceSelect")?.value === "tiers") bits.push("Equilibrado");
  if (payload.meta?.avoid_repeat) {
    bits.push(`Sem repetir (últ. ${payload.meta.avoid_repeat_window || 1})`);
  }
  bits.push(`Média OVR ${avg}`);
  bits.push(`Diferença ${diff}`);
  bits.push(`Equilíbrio: ${label}`);
  setText("resultMeta", bits.join(" · "));

  const cards = $("resultCards");
  if (cards) cards.innerHTML = "";

  const tbody = $("resultTbody");
  if (tbody) tbody.innerHTML = "";

  drawRows.forEach((row, idx) => {
    const labelText = categoryLabel(row);
    const badgeSource = row.team_name || row.participant;
    const colors = badgeColors(badgeSource);
    const badge = badgeText(badgeSource);

    const card = document.createElement("div");
    card.className = "result-card";
    card.style.setProperty("--badge", colors.solid);
    card.style.setProperty("--badge-soft", colors.soft);
    card.style.animationDelay = live ? `${idx * 120}ms` : `${idx * 35}ms`;

    const head = document.createElement("div");
    head.className = "result-head";

    const badgeEl = document.createElement("div");
    badgeEl.className = "team-badge";
    badgeEl.textContent = badge;

    const info = document.createElement("div");
    const playerEl = document.createElement("div");
    playerEl.className = "player";
    playerEl.textContent = row.participant || "";
    const teamEl = document.createElement("div");
    teamEl.className = "team";
    teamEl.textContent = row.team_name || "";
    const metaEl = document.createElement("div");
    metaEl.className = "muted small";
    metaEl.textContent = `${labelText}${row.overall ? ` · OVR ${row.overall}` : ""}`;

    info.appendChild(playerEl);
    info.appendChild(teamEl);
    info.appendChild(metaEl);

    head.appendChild(badgeEl);
    head.appendChild(info);
    card.appendChild(head);

    cards?.appendChild(card);

    const tr = document.createElement("tr");
    const cells = [
      row.participant || "",
      row.team_name || "",
      row.overall ?? "",
      row.attack ?? "",
      row.midfield ?? "",
      row.defence ?? row.defense ?? "",
    ];
    cells.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody?.appendChild(tr);
  });

  setResultView(state.resultView);
}

function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function roundName(size) {
  if (size <= 1) return "Final";
  if (size === 2) return "Final";
  if (size === 4) return "Semifinal";
  if (size === 8) return "Quartas de final";
  if (size === 16) return "Oitavas de final";
  if (size === 32) return "Rodada de 32";
  if (size === 64) return "Rodada de 64";
  return `Fase de ${size}`;
}

function createMatches(entries) {
  const matches = [];
  for (let i = 0; i < entries.length; i += 2) {
    const a = entries[i] || null;
    const b = entries[i + 1] || null;
    const winner = b ? null : a ? "a" : null;
    matches.push({ a, b, winner, scoreA: null, scoreB: null });
  }
  return matches;
}

function resetBracket() {
  bracketState.rounds = [];
  bracketState.pendingByes = [];
  renderBracket();
}

function buildBracket(drawRows, balanceMode) {
  resetBracket();

  const entries = (drawRows || []).map((row) => ({
    participant: row.participant,
    team_name: row.team_name,
    team_type: row.team_type,
    gender: row.gender,
    overall: row.overall,
    attack: row.attack,
    midfield: row.midfield,
    defence: row.defence,
    competition: row.competition,
    country: row.country,
  }));

  let seeded = entries;
  if (balanceMode === "tiers") {
    const sorted = entries
      .slice()
      .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0));
    seeded = [];
    let left = 0;
    let right = sorted.length - 1;
    while (left <= right) {
      seeded.push(sorted[left]);
      if (left !== right) seeded.push(sorted[right]);
      left += 1;
      right -= 1;
    }
  } else {
    seeded = shuffleArray(entries);
  }

  const total = seeded.length;
  let base = 1;
  while (base * 2 <= total) base *= 2;
  const extras = total - base;

  if (extras > 0) {
    const repCount = extras * 2;
    const repParticipants = seeded.slice(0, repCount);
    const byes = seeded.slice(repCount);
    bracketState.pendingByes = byes;
    bracketState.rounds.push({ name: "Repescagem", matches: createMatches(repParticipants) });
  } else {
    bracketState.rounds.push({ name: roundName(seeded.length), matches: createMatches(seeded) });
  }

  renderBracket();
}

function selectWinner(roundIndex, matchIndex, side) {
  const round = bracketState.rounds[roundIndex];
  if (!round) return;
  const match = round.matches[matchIndex];
  if (!match || !match[side]) return;
  match.winner = side;
  renderBracket();
  maybeAdvance(roundIndex);
}

function roundWinners(round) {
  const winners = [];
  for (const match of round.matches) {
    if (!match.winner) return null;
    winners.push(match[match.winner]);
  }
  return winners;
}

function maybeAdvance(roundIndex) {
  const round = bracketState.rounds[roundIndex];
  if (!round) return;
  if (bracketState.rounds[roundIndex + 1]) return;

  const winners = roundWinners(round);
  if (!winners) return;

  let participants = winners;
  if (roundIndex === 0 && bracketState.pendingByes.length > 0) {
    participants = winners.concat(bracketState.pendingByes);
    bracketState.pendingByes = [];
  }

  if (participants.length <= 1) {
    renderBracket();
    return;
  }

  bracketState.rounds.push({ name: roundName(participants.length), matches: createMatches(participants) });
  renderBracket();
}

function updateBracketStatus() {
  const status = $("bracketStatus");
  const nextBtn = $("nextRoundBtn");
  if (!status || !nextBtn) return;

  const format = $("formatSelect")?.value || "bracket";
  if (format === "round_robin") {
    status.textContent = "Todos contra todos";
    nextBtn.classList.add("d-none");
    return;
  }

  if (bracketState.rounds.length === 0) {
    status.textContent = "Gere o sorteio para montar o chaveamento.";
    nextBtn.classList.add("d-none");
    return;
  }

  const lastIndex = bracketState.rounds.length - 1;
  const round = bracketState.rounds[lastIndex];
  const decided = round.matches.filter((m) => m.winner).length;
  const total = round.matches.length;
  status.textContent = `${round.name}: ${decided}/${total} definidos`;

  if (decided === total && !bracketState.rounds[lastIndex + 1]) nextBtn.classList.remove("d-none");
  else nextBtn.classList.add("d-none");
}

function renderEntry(entry, isWinner) {
  const btn = document.createElement("button");
  btn.className = `match-btn ${isWinner ? "winner" : ""}`;
  btn.type = "button";

  if (!entry) {
    btn.classList.add("muted");
    btn.textContent = "Aguardando";
    btn.disabled = true;
    return btn;
  }

  const title = document.createElement("div");
  title.className = "match-title";
  title.textContent = entry.participant;
  const team = document.createElement("div");
  team.className = "match-team";
  team.textContent = entry.team_name;
  btn.appendChild(title);
  btn.appendChild(team);

  if (entry.overall) {
    const meta = document.createElement("div");
    meta.className = "match-meta";
    meta.textContent = `OVR ${entry.overall}`;
    btn.appendChild(meta);
  }
  return btn;
}

function applyScoreWinner(match) {
  const scoreA = Number(match.scoreA ?? "");
  const scoreB = Number(match.scoreB ?? "");
  if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) return;
  if (scoreA === scoreB) return;
  match.winner = scoreA > scoreB ? "a" : "b";
}

function swapHomeAway() {
  if (!bracketState.rounds.length) return;
  const round = bracketState.rounds[bracketState.rounds.length - 1];
  round.matches.forEach((match) => {
    [match.a, match.b] = [match.b, match.a];
    if (match.winner === "a") match.winner = "b";
    else if (match.winner === "b") match.winner = "a";
    [match.scoreA, match.scoreB] = [match.scoreB, match.scoreA];
  });
  renderBracket();
}

function drawBracketLines() {
  const svg = $("bracketLines");
  const grid = $("bracketContainer");
  if (!svg || !grid) return;

  const wrap = grid.parentElement;
  const rect = wrap.getBoundingClientRect();
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);
  svg.innerHTML = "";

  const columns = Array.from(grid.children);
  if (columns.length < 2) return;

  for (let c = 0; c < columns.length - 1; c += 1) {
    const col = columns[c];
    const nextCol = columns[c + 1];
    const matches = Array.from(col.querySelectorAll(".bracket-match"));
    const nextMatches = Array.from(nextCol.querySelectorAll(".bracket-match"));

    matches.forEach((match, idx) => {
      const matchRect = match.getBoundingClientRect();
      const startX = matchRect.right - rect.left + wrap.scrollLeft + 6;
      const startY = matchRect.top - rect.top + matchRect.height / 2 + wrap.scrollTop;

      const nextMatch = nextMatches[Math.floor(idx / 2)];
      if (!nextMatch) return;
      const nextRect = nextMatch.getBoundingClientRect();
      const endX = nextRect.left - rect.left + wrap.scrollLeft - 6;
      const endY = nextRect.top - rect.top + nextRect.height / 2 + wrap.scrollTop;

      const midX = (startX + endX) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
      path.setAttribute("stroke", "rgba(15, 23, 42, 0.25)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none");
      svg.appendChild(path);
    });
  }
}

function renderBracket() {
  const container = $("bracketContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!state.lastDraw) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "Gere o sorteio para montar o chaveamento.";
    container.appendChild(msg);
    updateBracketStatus();
    drawBracketLines();
    return;
  }

  const format = $("formatSelect")?.value || "bracket";
  $("bracketWrap")?.classList.toggle("d-none", format === "round_robin");
  $("rrBox")?.classList.toggle("d-none", format !== "round_robin");

  if (format === "round_robin") {
    updateBracketStatus();
    drawBracketLines();
    return;
  }

  if (bracketState.rounds.length === 0) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = 'Clique em "Sortear" para montar o chaveamento.';
    container.appendChild(msg);
    updateBracketStatus();
    drawBracketLines();
    return;
  }

  bracketState.rounds.forEach((round, rIdx) => {
    const col = document.createElement("div");
    col.className = "bracket-column";

    const title = document.createElement("div");
    title.className = "bracket-round-title";
    title.textContent = round.name;
    col.appendChild(title);

    round.matches.forEach((match, mIdx) => {
      const card = document.createElement("div");
      card.className = "bracket-match";

      const header = document.createElement("div");
      header.className = "match-header";
      header.textContent = `Jogo ${mIdx + 1}`;

      const aBtn = renderEntry(match.a, match.winner === "a");
      aBtn.onclick = () => selectWinner(rIdx, mIdx, "a");

      const bBtn = renderEntry(match.b, match.winner === "b");
      bBtn.onclick = () => selectWinner(rIdx, mIdx, "b");

      const vs = document.createElement("div");
      vs.className = "match-vs";
      vs.textContent = "VS";

      const scoreRow = document.createElement("div");
      scoreRow.className = "match-score";

      const inputA = document.createElement("input");
      inputA.type = "number";
      inputA.min = "0";
      inputA.value = match.scoreA ?? "";
      inputA.placeholder = "-";
      inputA.onchange = (e) => {
        match.scoreA = e.target.value === "" ? null : parseInt(e.target.value, 10);
      };

      const inputB = document.createElement("input");
      inputB.type = "number";
      inputB.min = "0";
      inputB.value = match.scoreB ?? "";
      inputB.placeholder = "-";
      inputB.onchange = (e) => {
        match.scoreB = e.target.value === "" ? null : parseInt(e.target.value, 10);
      };

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-ghost btn-sm";
      applyBtn.textContent = "Confirmar";
      applyBtn.onclick = () => {
        applyScoreWinner(match);
        renderBracket();
        maybeAdvance(rIdx);
      };

      scoreRow.appendChild(inputA);
      scoreRow.appendChild(document.createTextNode("x"));
      scoreRow.appendChild(inputB);
      scoreRow.appendChild(applyBtn);

      card.appendChild(header);
      card.appendChild(aBtn);
      card.appendChild(vs);
      card.appendChild(bBtn);
      card.appendChild(scoreRow);
      col.appendChild(card);
    });

    container.appendChild(col);
  });

  updateBracketStatus();
  requestAnimationFrame(drawBracketLines);
}

async function runRoundRobin() {
  if (!state.lastDraw) return;
  const rrBox = $("rrBox");
  const rrTbody = $("rrTbody");
  const rrMeta = $("rrMeta");
  const bracketWrap = $("bracketWrap");
  if (!rrBox || !rrTbody || !rrMeta) return;

  rrTbody.innerHTML = "";
  rrBox.classList.remove("d-none");
  bracketWrap?.classList.add("d-none");

  let res;
  try {
    res = await fetch("/api/round_robin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draw: state.lastDraw.draw || [] }),
    });
  } catch {
    showError("Falha ao gerar todos contra todos.");
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(data.error || "Falha ao gerar todos contra todos.");
    return;
  }

  rrMeta.textContent = `${data.players} jogadores · ${data.total_matches} partidas`;
  (data.matches || []).forEach((m, idx) => {
    const tr = document.createElement("tr");
    const cells = [
      idx + 1,
      m.a?.participant || "",
      m.a?.team_name || "",
      "vs",
      m.b?.participant || "",
      m.b?.team_name || "",
    ];
    cells.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    rrTbody.appendChild(tr);
  });

  updateBracketStatus();
}

function roomLinkFromCode(code) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = new URL(base);
  url.searchParams.set("code", code);
  return url.toString();
}

function buildRoomPayload() {
  const payload = {
    dataset: state.dataset,
    participants: state.participants,
    filters: buildFiltersFromUI(),
    ui: {
      preset: state.preset,
      mode: $("modeSelect")?.value || "all",
      category: $("categorySelect")?.value || "all",
      top_n: parseInt($("topNInput")?.value || "10", 10),
      format: $("formatSelect")?.value || "bracket",
      balance: $("balanceSelect")?.value || "random",
      avoid_repeat: Boolean($("avoidRepeatToggle")?.checked),
      avoid_repeat_3: Boolean($("avoidRepeat3Toggle")?.checked),
      live_mode: Boolean($("liveModeToggle")?.checked),
    },
  };

  if (state.lastDraw?.draw) {
    payload.draw = state.lastDraw.draw;
    payload.meta = state.lastDraw.meta;
    payload.pool_count = state.lastDraw.pool_count;
  }

  return payload;
}

function extractShareCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const qp = url.searchParams.get("code");
    if (qp) return qp;
    const m = url.pathname.match(/\/s\/([a-z0-9]+)/i);
    if (m?.[1]) return m[1];
  } catch {
    // ignore
  }

  const q = raw.match(/code=([a-z0-9]+)/i);
  if (q?.[1]) return q[1];
  const m = raw.match(/\/s\/([a-z0-9]+)/i);
  if (m?.[1]) return m[1];

  return raw.replace(/[^a-z0-9]/gi, "");
}

function updateRoomControls() {
  const createBtn = $("roomCreateBtn");
  const copyBtn = $("roomCopyLinkBtn");
  const input = $("roomCodeInput");

  if (createBtn) createBtn.textContent = state.room.code ? "Salvar sala" : "Criar sala";
  if (copyBtn) copyBtn.disabled = !state.room.url;
  if (input && state.room.code) input.value = state.room.code;
  const pill = $("roomStatusTop");
  if (pill) pill.textContent = state.room.code ? `Sala: ${state.room.code}` : "Sala: offline";
}

async function createShareCode({ forceNew = false, silent = false } = {}) {
  const payload = buildRoomPayload();
  const wantsUpdate = Boolean(state.room.code) && !forceNew;
  const endpoint = wantsUpdate ? `/api/share/${encodeURIComponent(state.room.code)}` : "/api/share";
  const method = wantsUpdate ? "PUT" : "POST";

  const res = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!silent) setText("roomStatus", data.error || "Não foi possível salvar a sala.");
    return null;
  }

  state.room = {
    code: String(data.code || "").toUpperCase(),
    url: data.url || roomLinkFromCode(String(data.code || "")),
  };
  updateRoomControls();

  if (!silent) {
    setText("roomStatus", wantsUpdate ? `Sala atualizada: ${state.room.code}` : `Sala criada: ${state.room.code}`);
  }

  return data;
}

async function joinShareCode(value) {
  const extracted = extractShareCode(value);
  const clean = String(extracted || "").trim().toUpperCase();
  if (!clean) return;

  const res = await fetch(`/api/share/${encodeURIComponent(clean)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setText("roomStatus", data.error || "Código não encontrado.");
    return;
  }

  setDataset(data.dataset || "fc25");

  if (data.ui?.preset && PRESETS[data.ui.preset] && PRESETS[data.ui.preset].dataset === (data.dataset || "fc25")) {
    applyPreset(data.ui.preset);
  }
  if (data.ui?.mode && $("modeSelect")) $("modeSelect").value = data.ui.mode;
  if (data.ui?.category && $("categorySelect")) $("categorySelect").value = data.ui.category;
  if (Number.isFinite(Number(data.ui?.top_n)) && $("topNInput")) $("topNInput").value = String(data.ui.top_n);
  if (data.ui?.format && $("formatSelect")) $("formatSelect").value = data.ui.format;
  if (data.ui?.balance && $("balanceSelect")) $("balanceSelect").value = data.ui.balance;
  if ($("avoidRepeatToggle")) $("avoidRepeatToggle").checked = Boolean(data.ui?.avoid_repeat);
  if ($("avoidRepeat3Toggle")) $("avoidRepeat3Toggle").checked = Boolean(data.ui?.avoid_repeat_3);
  if ($("liveModeToggle")) $("liveModeToggle").checked = Boolean(data.ui?.live_mode);
  toggleTopN();
  updateOptionSummary();

  state.participants = Array.isArray(data.participants) ? data.participants : [];
  renderParticipants();

  state.room = { code: clean, url: roomLinkFromCode(clean) };
  updateRoomControls();

  const url = new URL(window.location.href);
  url.searchParams.set("code", clean);
  window.history.replaceState({}, "", url.toString());

  if (Array.isArray(data.draw) && data.draw.length) {
    state.lastDraw = data;
    renderResults(data, { live: false });
    showResultsPanel();
    $("bracketSection")?.classList.add("d-none");
    $("shareSection")?.classList.add("d-none");
  } else {
    state.lastDraw = null;
    resetResults();
  }

  $("roomDialog")?.close();
  setText("roomStatus", `Sala carregada: ${clean}`);
}

function setupRoomDialog() {
  const dialog = $("roomDialog");
  if (!dialog) return;

  const openBtn = $("roomOpenBtn");
  const closeBtn = $("roomCloseBtn");
  const joinBtn = $("roomJoinBtn");
  const createBtn = $("roomCreateBtn");
  const copyLinkBtn = $("roomCopyLinkBtn");

  openBtn?.addEventListener("click", () => {
    updateRoomControls();
    if (state.room.code) setText("roomStatus", `Sala atual: ${state.room.code}`);
    dialog.showModal();
    $("roomCodeInput")?.focus();
  });
  closeBtn?.addEventListener("click", () => {
    dialog.close();
    openBtn?.focus();
  });
  dialog.addEventListener("close", () => openBtn?.focus());

  joinBtn?.addEventListener("click", async () => {
    clearError();
    const code = $("roomCodeInput")?.value || "";
    await joinShareCode(code);
  });

  createBtn?.addEventListener("click", async () => {
    clearError();
    await createShareCode();
  });

  copyLinkBtn?.addEventListener("click", async () => {
    clearError();
    if (!state.room.url) {
      const created = await createShareCode();
      if (!created) return;
    }
    try {
      await copyToClipboard(state.room.url);
      setText("roomStatus", `Link copiado (${state.room.code})`);
      announce("Link copiado.");
    } catch {
      setText("roomStatus", `Sala: ${state.room.code}`);
    }
  });
}

async function init() {
  const savedTheme = localStorage.getItem("themeMode") || "light";
  applyThemeMode(savedTheme);

  $("themeToggleBtn")?.addEventListener("click", () => {
    const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
    localStorage.setItem("themeMode", next);
    applyThemeMode(next);
  });

  $("datasetFc25Btn")?.addEventListener("click", () => setDataset("fc25"));
  $("datasetNbaBtn")?.addEventListener("click", () => setDataset("nba"));

  $("presetSelect")?.addEventListener("change", (e) => {
    applyPreset(e.target.value);
    updateOptionSummary();
  });
  $("modeSelect")?.addEventListener("change", () => {
    toggleTopN();
    updateOptionSummary();
  });

  const formatSelect = $("formatSelect");
  formatSelect?.addEventListener("change", async () => {
    updateOptionSummary();
    const bracketSection = $("bracketSection");
    if (!state.lastDraw || !bracketSection || bracketSection.classList.contains("d-none")) return;
    if (formatSelect.value === "round_robin") await runRoundRobin();
    else buildBracket(state.lastDraw.draw || [], $("balanceSelect")?.value || "random");
  });

  $("balanceSelect")?.addEventListener("change", () => {
    updateOptionSummary();
    const bracketSection = $("bracketSection");
    if (!state.lastDraw || !bracketSection || bracketSection.classList.contains("d-none")) return;
    const format = $("formatSelect")?.value || "bracket";
    if (format === "bracket") buildBracket(state.lastDraw.draw || [], $("balanceSelect")?.value || "random");
  });

  const input = $("participantInput");
  $("addParticipantBtn")?.addEventListener("click", () => {
    const name = normalizeName(input?.value);
    if (!name) return;
    const exists = state.participants.some((p) => p.toLowerCase() === name.toLowerCase());
    if (exists) {
      showError("Jogador duplicado.");
      return;
    }
    state.participants.push(name);
    if (input) input.value = "";
    renderParticipants();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("addParticipantBtn")?.click();
  });

  $("bulkInput")?.addEventListener("input", (e) => updateBulkFeedback(e.target.value));

  $("importBtn")?.addEventListener("click", () => {
    const bulk = $("bulkInput");
    if (!bulk) return;
    const lines = String(bulk.value || "").split(/\r?\n/);
    const unique = uniqueCaseInsensitive(lines);
    const before = state.participants.length;
    unique.forEach((name) => {
      const exists = state.participants.some((p) => p.toLowerCase() === name.toLowerCase());
      if (!exists) state.participants.push(name);
    });
    const added = state.participants.length - before;
    setText("bulkFeedback", `${unique.length} nomes · ${added} adicionados`);
    bulk.value = "";
    renderParticipants();
  });

  $("pasteBtn")?.addEventListener("click", async () => {
    clearError();
    if (!navigator.clipboard?.readText) {
      showError("Clipboard indisponível no navegador.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const names = String(text || "").split(/[\r\n,;]+/);
      const unique = uniqueCaseInsensitive(names);
      unique.forEach((name) => {
        const exists = state.participants.some((p) => p.toLowerCase() === name.toLowerCase());
        if (!exists) state.participants.push(name);
      });
      renderParticipants();
    } catch {
      showError("Não foi possível acessar o clipboard.");
    }
  });

  $("undoBtn")?.addEventListener("click", () => {
    if (!state.lastRemoved) return;
    const exists = state.participants.some((p) => p.toLowerCase() === state.lastRemoved.toLowerCase());
    if (!exists) state.participants.push(state.lastRemoved);
    state.lastRemoved = null;
    renderParticipants();
  });

  $("sortParticipantsBtn")?.addEventListener("click", () => {
    state.participants.sort((a, b) => a.localeCompare(b));
    renderParticipants();
  });

  $("clearParticipantsBtn")?.addEventListener("click", () => {
    state.participants = [];
    state.lastRemoved = null;
    renderParticipants();
    resetResults();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      if (state.participants.length === 0) {
        const details = $("pasteDetails");
        const bulk = $("bulkInput");
        if (details && bulk) {
          details.open = true;
          bulk.focus();
        }
      }
    }
  });

  const liveToggle = $("liveModeToggle");
  if (liveToggle) {
    liveToggle.checked = getStorageBool("liveMode", false);
    liveToggle.addEventListener("change", () => setStorageBool("liveMode", liveToggle.checked));
  }

  $("drawBtn")?.addEventListener("click", drawNow);

  $("toggleViewBtn")?.addEventListener("click", () => setResultView(state.resultView === "table" ? "cards" : "table"));

  $("shareResultPngBtn")?.addEventListener("click", () => exportPng("shareCapture", "sorteio.png"));
  $("shareBracketPngBtn")?.addEventListener("click", () => exportPng("bracketWrap", "chaveamento.png"));

  $("swapHomeBtn")?.addEventListener("click", swapHomeAway);
  $("generateBracketBtn")?.addEventListener("click", async () => {
    if (!state.lastDraw) return;
    $("bracketSection")?.classList.remove("d-none");
    $("shareSection")?.classList.remove("d-none");
    const format = $("formatSelect")?.value || "bracket";
    if (format === "round_robin") await runRoundRobin();
    else {
      $("rrBox")?.classList.add("d-none");
      buildBracket(state.lastDraw.draw || [], $("balanceSelect")?.value || "random");
    }
  });

  $("shareOpenBtn")?.addEventListener("click", () => {
    const dialog = $("shareDialog");
    if (!dialog) return;
    dialog.showModal();
    $("shareWhatsBtn")?.focus();
  });

  $("shareCloseBtn")?.addEventListener("click", () => {
    $("shareDialog")?.close();
    $("shareOpenBtn")?.focus();
  });

  $("shareWhatsBtn")?.addEventListener("click", copyWhatsApp);
  $("shareCsvBtn")?.addEventListener("click", copyCsv);
  $("shareLinkBtn")?.addEventListener("click", async () => {
    clearError();
    if (!state.room.url) {
      const created = await createShareCode();
      if (!created) return;
    }
    try {
      await copyToClipboard(state.room.url);
      setText("shareStatus", `Link copiado (${state.room.code})`);
      announce("Link copiado.");
    } catch {
      setText("shareStatus", `Sala: ${state.room.code}`);
    }
  });
  $("nextRoundBtn")?.addEventListener("click", () => {
    const lastIndex = bracketState.rounds.length - 1;
    if (lastIndex >= 0) maybeAdvance(lastIndex);
  });

  window.addEventListener("resize", drawBracketLines);

  setupRoomDialog();

  await loadRemotePools();

  setDataset("fc25");
  toggleTopN();
  updateOptionSummary();
  renderParticipants();
  renderBracket();
  resetResults();

  const urlCode = new URLSearchParams(window.location.search).get("code");
  if (urlCode) await joinShareCode(urlCode);
}

document.addEventListener("DOMContentLoaded", init);
