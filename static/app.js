const participants = [];
let lastRemoved = null;
let lastDraw = null;
let resultView = "cards";
let liveMode = false;

const PRO_DEFAULT_URL = "https://wa.me/55SEU_NUMERO?text=Quero%20assinar%20o%20Sorteio%20Pro";

const datasetState = {
  current: "fc25"
};

const bracketState = {
  rounds: [],
  pendingByes: []
};

const presets = {
  champions: { theme: "champions", dataset: "fc25", rules: { balance: "overall", avoidRepeat: true, mode: "all" } },
  selecoes: { theme: "selecoes", dataset: "fc25", rules: { balance: "matchup", category: "national", mode: "national" } },
  classicos: { theme: "classicos", dataset: "fc25", rules: { balance: "overall", category: "clubs", mode: "clubs" } },
  playoffs: { theme: "libertadores", dataset: "nba", rules: { balance: "overall", avoidRepeat: true, mode: "all" } }
};

const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll(".tab-panel");
const themeButtons = document.querySelectorAll("[data-theme]");

const themeCopy = {
  champions: {
    kicker: "Sorteio de Times para EA FC e NBA 2K",
    title: "Sorteio r\u00e1pido",
    subtitle: "Monte os jogadores e gere confrontos em segundos."
  },
  playoffs: {
    kicker: "Sorteio de Times para EA FC e NBA 2K",
    title: "Playoffs NBA",
    subtitle: "Chaves diretas, ritmo de eliminat\u00f3rias."
  },
  selecoes: {
    kicker: "Sorteio de Times para EA FC e NBA 2K",
    title: "Sele\u00e7\u00f5es em foco",
    subtitle: "Sorteie sele\u00e7\u00f5es e mantenha o equil\u00edbrio entre os jogadores."
  },
  classicos: {
    kicker: "Sorteio de Times para EA FC e NBA 2K",
    title: "Cl\u00e1ssicos e rivalidades",
    subtitle: "R\u00e1pido para montar elencos e dividir os times."
  }
};

function setActiveTab(tabId) {
  if (!tabButtons.length || !tabPanels.length) return;
  tabButtons.forEach((btn) => {
    const target = btn.getAttribute("data-tab-target");
    btn.classList.toggle("active", target === tabId);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-tab") === tabId);
  });

  const lock = tabId === "jogadores";
  tabButtons.forEach((btn) => {
    const target = btn.getAttribute("data-tab-target");
    if (!target) return;
    const keepEnabled = ["jogadores", "opcoes"].includes(target);
    if (lock && !keepEnabled) {
      btn.classList.add("disabled");
      btn.setAttribute("disabled", "disabled");
    } else if (!lock) {
      btn.classList.remove("disabled");
      btn.removeAttribute("disabled");
    }
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("disabled") || btn.hasAttribute("disabled")) return;
    const target = btn.getAttribute("data-tab-target");
    if (target) setActiveTab(target);
  });
});

function setTheme(theme) {
  const body = document.body;
  if (!body) return;
  body.classList.remove("theme-champions", "theme-libertadores", "theme-selecoes", "theme-classicos");
  if (theme) body.classList.add(`theme-${theme}`);

  themeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-theme") === theme);
  });

  const copy = themeCopy[theme];
  if (copy) {
    const kicker = document.getElementById("heroKicker");
    const title = document.getElementById("heroTitle");
    const subtitle = document.getElementById("heroSubtitle");
    if (kicker) kicker.textContent = copy.kicker;
    if (title) title.textContent = copy.title;
    if (subtitle) subtitle.textContent = copy.subtitle;
  }
}

function normalizeName(name) {
  return String(name || "").trim();
}

function generateSeed() {
  return Math.random().toString(16).slice(2, 6).toUpperCase();
}

function getStorageBool(key, fallback = false) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

function setStorageBool(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
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

function badgeText(value) {
  const clean = String(value || "").trim();
  if (!clean) return "SP";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function badgeColors(value) {
  const h = hashString(value) % 360;
  return {
    solid: `hsl(${h} 70% 55%)`,
    soft: `hsla(${h} 70% 55% / 0.2)`
  };
}

function getLiveMode() {
  const toggle = document.getElementById("liveModeToggle");
  if (toggle) return toggle.checked;
  return getStorageBool("liveMode", false);
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  if (preset.theme) {
    setTheme(preset.theme);
  }

  const rules = preset.rules || {};
  const balanceSelect = document.getElementById("balanceSelect");
  if (balanceSelect && rules.balance && balanceSelect.querySelector(`option[value="${rules.balance}"]`)) {
    balanceSelect.value = rules.balance;
  }

  const avoidRepeatToggle = document.getElementById("avoidRepeatToggle");
  if (avoidRepeatToggle && typeof rules.avoidRepeat === "boolean") {
    avoidRepeatToggle.checked = rules.avoidRepeat;
  }

  const avoidRepeat3Toggle = document.getElementById("avoidRepeat3Toggle");
  if (avoidRepeat3Toggle && typeof rules.avoidRepeat3 === "boolean") {
    avoidRepeat3Toggle.checked = rules.avoidRepeat3;
  }

  const modeSelect = document.getElementById("modeSelect");
  if (modeSelect && rules.mode && modeSelect.querySelector(`option[value="${rules.mode}"]`)) {
    modeSelect.value = rules.mode;
    toggleTopN();
  }

  const categorySelect = document.getElementById("categorySelect");
  if (categorySelect && rules.category && categorySelect.querySelector(`option[value="${rules.category}"]`)) {
    categorySelect.value = rules.category;
  }

  syncModeCategory();
}

function renderResults(drawObj, seedFallback) {
  if (!drawObj) return;
  setActionButtons(true);
  document.querySelectorAll(".post-draw").forEach((el) => el.classList.remove("d-none"));
  enableFutureTabs();

  const live = getLiveMode();
  const cards = document.getElementById("resultCards");
  if (cards) {
    cards.innerHTML = "";
    drawObj.draw.forEach((row, idx) => {
      const label = categoryLabel(row.team_type, row.gender);
      const badgeSource = row.team_name || row.participant;
      const colors = badgeColors(badgeSource);
      const badge = badgeText(badgeSource);
      const card = document.createElement("div");
      card.className = "result-card";
      card.style.setProperty("--badge", colors.solid);
      card.style.setProperty("--badge-soft", colors.soft);
      card.innerHTML = `
        <div class="result-head">
          <div class="team-badge">${badge}</div>
          <div>
            <div class="player">${row.participant}</div>
            <div class="team">${row.team_name}</div>
            <div class="muted small">${label}</div>
          </div>
        </div>
        <div class="result-badges">
          <span class="badge-pill">OVR ${row.overall}</span>
          <span class="badge-pill">ATT ${row.attack}</span>
          <span class="badge-pill">MID ${row.midfield}</span>
          <span class="badge-pill">DEF ${row.defence}</span>
        </div>
      `;
      if (live) {
        card.classList.add("live-reveal");
        setTimeout(() => card.classList.add("is-visible"), idx * 120);
      }
      cards.appendChild(card);
    });
  }

  const tbody = document.getElementById("resultTbody");
  if (tbody) {
    tbody.innerHTML = "";
    drawObj.draw.forEach((row) => {
      const tr = document.createElement("tr");
      const label = categoryLabel(row.team_type, row.gender);
      tr.innerHTML = `
        <td>${row.participant}</td>
        <td>${row.team_name}</td>
        <td>${label}</td>
        <td>${row.overall}</td>
        <td>${row.attack}</td>
        <td>${row.midfield}</td>
        <td>${row.defence}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const resultMeta = document.getElementById("resultMeta");
  if (resultMeta) {
    const meta = drawObj.meta || {};
    const when = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : "";
    const seedLabel = meta.seed === "auto" ? seedFallback : meta.seed || seedFallback || "N/A";
    const balanceLabel = meta.balance_mode === "tiers" ? "tiers A/B/C/D" : "aleat\u00f3rio";
    const repeatLabel = meta.avoid_repeat ? `sem repeti\u00e7\u00e3o (${meta.avoid_repeat_window || 1})` : "repeti\u00e7\u00e3o liberada";
    const ovrs = drawObj.draw.map((row) => Number(row.overall || 0)).filter((v) => !Number.isNaN(v));
    const avg = ovrs.length ? Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length) : 0;
    const diff = ovrs.length ? Math.max(...ovrs) - Math.min(...ovrs) : 0;
    const eq = diff <= 3 ? "alto" : diff <= 6 ? "bom" : "m\u00e9dio";
    resultMeta.textContent = `Seed: ${seedLabel} | ${when} | Balanceamento: ${balanceLabel} | ${repeatLabel} | M\u00e9dia OVR ${avg} | Diferen\u00e7a ${diff} | Equil\u00edbrio ${eq}`;
  }

  setResultView(resultView);
}

function updateBulkFeedback(value) {
  const feedback = document.getElementById("bulkFeedback");
  if (!feedback) return;
  const lines = (value || "")
    .split(/\r?\n/)
    .map((s) => normalizeName(s))
    .filter(Boolean);
  if (!lines.length) {
    feedback.textContent = "";
    return;
  }
  const unique = new Set(lines.map((item) => item.toLowerCase()));
  const dupes = lines.length - unique.size;
  feedback.textContent = `${lines.length} nomes detectados \u00b7 ${dupes} duplicados na lista`;
}

function renderParticipants() {
  const ul = document.getElementById("participantsList");
  const title = document.getElementById("participantTitle");
  if (title) title.textContent = `Jogadores (${participants.length})`;

  ul.innerHTML = "";

  if (!participants.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state muted small";
    empty.textContent = "Cole aqui (1 por linha).";
    ul.appendChild(empty);
    return;
  }

  participants.forEach((name, idx) => {
    const li = document.createElement("div");
    li.className = "chip";

    const span = document.createElement("span");
    span.textContent = name;

    const btn = document.createElement("button");
    btn.className = "chip-remove";
    btn.innerHTML = "&#128465;";
    btn.setAttribute("aria-label", "Remover");
    btn.onclick = () => {
      lastRemoved = participants.splice(idx, 1)[0];
      renderParticipants();
    };

    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function showError(msg) {
  const box = document.getElementById("errorBox");
  box.textContent = msg;
  box.classList.remove("d-none");
}

function clearError() {
  const box = document.getElementById("errorBox");
  box.textContent = "";
  box.classList.add("d-none");
}

function formatCount(value) {
  return value ?? "--";
}

function categoryLabel(teamType, gender) {
  const t = (teamType || "").toUpperCase();
  const g = (gender || "").toUpperCase();

  if (datasetState.current === "nba") {
    return g === "WOMEN" ? "WNBA" : "NBA";
  }

  if (t === "NATIONAL" && g === "WOMEN") return "Sele\u00e7\u00f5es femininas";
  if (t === "NATIONAL" && g === "MEN") return "Sele\u00e7\u00f5es masculinas";
  if (t === "CLUB" && g === "WOMEN") return "Clubes femininos";
  if (t === "CLUB" && g === "MEN") return "Clubes masculinos";
  if (t === "NATIONAL") return "Sele\u00e7\u00f5es";
  return "Clubes";
}

function roundName(size) {
  if (size <= 1) return "Campeao";
  if (size === 2) return "Final";
  if (size === 4) return "Semifinal";
  if (size === 8) return "Quartas de final";
  if (size === 16) return "Oitavas de final";
  if (size === 32) return "Rodada de 32";
  if (size === 64) return "Rodada de 64";
  return `Fase de ${size}`;
}

function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createMatches(entries) {
  const matches = [];
  for (let i = 0; i < entries.length; i += 2) {
    const a = entries[i] || null;
    const b = entries[i + 1] || null;
    const winner = b ? null : (a ? "a" : null);
    matches.push({ a, b, winner });
  }
  return matches;
}

function resetBracket() {
  bracketState.rounds = [];
  bracketState.pendingByes = [];
  renderBracket();
}

function buildBracket(draw) {
  resetBracket();

  const entries = shuffleArray(draw).map((row) => ({
    participant: row.participant,
    team_name: row.team_name,
    team_type: row.team_type,
    gender: row.gender,
    overall: row.overall,
    attack: row.attack,
    midfield: row.midfield,
    defence: row.defence,
    competition: row.competition,
    country: row.country
  }));

  const total = entries.length;
  let base = 1;
  while (base * 2 <= total) base *= 2;
  const extras = total - base;

  if (extras > 0) {
    const repCount = extras * 2;
    const repParticipants = entries.slice(0, repCount);
    const byes = entries.slice(repCount);
    bracketState.pendingByes = byes;
    bracketState.rounds.push({
      name: "Repescagem",
      matches: createMatches(repParticipants)
    });
  } else {
    bracketState.rounds.push({
      name: roundName(entries.length),
      matches: createMatches(entries)
    });
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

  bracketState.rounds.push({
    name: roundName(participants.length),
    matches: createMatches(participants)
  });
  renderBracket();
}

function updateBracketStatus() {
  const status = document.getElementById("bracketStatus");
  const nextBtn = document.getElementById("nextRoundBtn");
  if (!status || !nextBtn) return;

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

  if (decided === total && !bracketState.rounds[lastIndex + 1]) {
    nextBtn.classList.remove("d-none");
  } else {
    nextBtn.classList.add("d-none");
  }
}

function renderEntry(entry, isWinner) {
  const btn = document.createElement("button");
  btn.className = `match-btn ${isWinner ? "winner" : ""}`;

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

  const meta = document.createElement("div");
  meta.className = "match-meta";
  meta.textContent = `${categoryLabel(entry.team_type, entry.gender)} | OVR ${entry.overall}`;

  btn.appendChild(title);
  btn.appendChild(team);
  btn.appendChild(meta);

  return btn;
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

function applyScoreWinner(match) {
  const scoreA = Number(match.scoreA ?? "");
  const scoreB = Number(match.scoreB ?? "");
  if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) return;
  if (scoreA === scoreB) return;
  match.winner = scoreA > scoreB ? "a" : "b";
}

function drawBracketLines() {
  const svg = document.getElementById("bracketLines");
  const grid = document.getElementById("bracketContainer");
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
      path.setAttribute(
        "d",
        `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
      );
      path.setAttribute("stroke", "rgba(15, 23, 42, 0.25)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none");
      svg.appendChild(path);
    });
  }
}

function renderBracket() {
  const container = document.getElementById("bracketContainer");
  if (!container) return;
  container.innerHTML = "";

  if (bracketState.rounds.length === 0) {
    container.innerHTML = "<div class=\"muted\">Gere o sorteio para montar o chaveamento.</div>";
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

function renderRoundRobin(rr) {
  const box = document.getElementById("rrBox");
  const meta = document.getElementById("rrMeta");
  const tbody = document.getElementById("rrTbody");
  if (!box || !meta || !tbody) return;

  box.classList.remove("d-none");
  meta.textContent = `Participantes: ${rr.players}. Total de jogos: ${rr.total_matches}.`;
  tbody.innerHTML = "";

  (rr.matches || []).forEach((m, idx) => {
    const a = m.a || {};
    const b = m.b || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${a.participant || ""}</td>
      <td>${a.team_name || ""}</td>
      <td>vs</td>
      <td>${b.participant || ""}</td>
      <td>${b.team_name || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateModeOptions() {
  const select = document.getElementById("modeSelect");
  if (!select) return;

  const previous = select.value;
  const options = [
    { value: "all", label: "Todos os times" },
    { value: "top", label: "Top N por overall" }
  ];

  if (datasetState.current !== "nba") {
    options.push({ value: "clubs", label: "Somente clubes" });
    options.push({ value: "national", label: "Somente sele\u00e7\u00f5es" });
  }

  select.innerHTML = "";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });

  if (previous && options.some((opt) => opt.value === previous)) {
    select.value = previous;
  } else {
    select.value = "all";
  }

  toggleTopN();
  syncModeCategory();
}

function syncModeCategory() {
  const modeSelect = document.getElementById("modeSelect");
  const categorySelect = document.getElementById("categorySelect");
  if (!modeSelect || !categorySelect) return;

  if (modeSelect.value === "clubs") {
    const target = datasetState.current === "nba" ? "clubs_men" : "clubs";
    if (categorySelect.querySelector(`option[value="${target}"]`)) {
      categorySelect.value = target;
    }
  } else if (modeSelect.value === "national") {
    const target = "national";
    if (categorySelect.querySelector(`option[value="${target}"]`)) {
      categorySelect.value = target;
    }
  }
}

function updateCategoryOptions() {
  const select = document.getElementById("categorySelect");
  if (!select) return;

  const previous = select.value;
  const options = [];

  if (datasetState.current === "nba") {
    options.push({ value: "all", label: "Todos os times" });
    options.push({ value: "clubs_men", label: "NBA (masculino)" });
    options.push({ value: "clubs_women", label: "WNBA (feminino)" });
  } else {
    options.push({ value: "all", label: "Todas" });
    options.push({ value: "clubs", label: "Clubes (todos)" });
    options.push({ value: "clubs_men", label: "Clubes masculinos" });
    options.push({ value: "clubs_women", label: "Clubes femininos" });
    options.push({ value: "national", label: "Sele\u00e7\u00f5es (todas)" });
    options.push({ value: "national_men", label: "Sele\u00e7\u00f5es masculinas" });
    options.push({ value: "national_women", label: "Sele\u00e7\u00f5es femininas" });
  }

  select.innerHTML = "";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });

  if (previous && options.some((opt) => opt.value === previous)) {
    select.value = previous;
  }
}

function updateDatasetTabs() {
  const fcBtn = document.getElementById("datasetFc25Btn");
  const nbaBtn = document.getElementById("datasetNbaBtn");
  if (!fcBtn || !nbaBtn) return;

  fcBtn.classList.toggle("active", datasetState.current === "fc25");
  nbaBtn.classList.toggle("active", datasetState.current === "nba");
}

function updateStatsLabels(stats) {
  const infoTotal = document.getElementById("infoTotal");
  const infoClubs = document.getElementById("infoClubs");
  const infoWomen = document.getElementById("infoWomen");
  const infoNational = document.getElementById("infoNational");
  const labelTotal = document.getElementById("labelTotal");
  const labelClubs = document.getElementById("labelClubs");
  const labelWomen = document.getElementById("labelWomen");
  const labelNational = document.getElementById("labelNational");

  if (!infoTotal || !infoClubs || !infoWomen || !infoNational) return;
  if (!labelTotal || !labelClubs || !labelWomen || !labelNational) return;

  if (datasetState.current === "nba") {
    infoTotal.textContent = formatCount(stats.total_teams);
    infoClubs.textContent = formatCount(stats.counts?.clubs);
    infoWomen.textContent = formatCount(stats.counts?.women);
    infoNational.textContent = formatCount(stats.counts?.men ?? "--");
    labelTotal.textContent = "Times";
    labelClubs.textContent = "NBA";
    labelWomen.textContent = "WNBA";
    labelNational.textContent = "Masc";
  } else {
    infoTotal.textContent = formatCount(stats.total_teams);
    infoClubs.textContent = formatCount(stats.counts?.clubs);
    infoWomen.textContent = formatCount(stats.counts?.women);
    infoNational.textContent = formatCount(stats.counts?.national);
    labelTotal.textContent = "Times";
    labelClubs.textContent = "Clubes";
    labelWomen.textContent = "Feminino";
    labelNational.textContent = "Sele\u00e7\u00f5es";
  }
}

async function loadTeamsInfo() {
  try {
    const r = await fetch(`/api/teams_info?dataset=${datasetState.current}`);
    const j = await r.json();
    const el = document.getElementById("teamsInfo");
    if (el) {
      el.textContent = `Base: ${j.total_teams} | OVR min: ${j.min_overall} | OVR max: ${j.max_overall}`;
    }
    updateStatsLabels(j);
  } catch {
    // silencioso
  }
}

function disableFutureTabs() {
  tabButtons.forEach((btn) => {
    const target = btn.getAttribute("data-tab-target");
    if (target && !["jogadores", "opcoes"].includes(target)) {
      btn.classList.add("disabled");
      btn.setAttribute("disabled", "disabled");
    }
  });
}

function enableFutureTabs() {
  tabButtons.forEach((btn) => {
    btn.classList.remove("disabled");
    btn.removeAttribute("disabled");
  });
}

function setDataset(dataset) {
  datasetState.current = dataset;
  const body = document.body;
  if (body) {
    body.classList.remove("theme-nba");
    if (dataset === "nba") body.classList.add("theme-nba");
  }
  updateDatasetTabs();
  updateCategoryOptions();
  updateModeOptions();
  if (presetSelect) applyPreset(presetSelect.value);
  toggleTopN();
  loadTeamsInfo();
  resetBracket();

  const rrBox = document.getElementById("rrBox");
  if (rrBox) rrBox.classList.add("d-none");

  const cards = document.getElementById("resultCards");
  if (cards) {
    cards.innerHTML = "";
  }
  lastDraw = null;
  setActionButtons(false);
  setResultView("cards");
}

function toggleTopN() {
  const modeSelect = document.getElementById("modeSelect");
  const topWrap = document.getElementById("topNWrap");
  if (!modeSelect || !topWrap) return;
  topWrap.classList.toggle("d-none", modeSelect.value !== "top");
}

function setResultView(view) {
  resultView = view;
  const cards = document.getElementById("resultCards");
  const tableWrap = document.getElementById("resultTableWrap");
  const toggleBtn = document.getElementById("toggleViewBtn");
  if (cards) cards.classList.toggle("d-none", view === "table");
  if (tableWrap) tableWrap.classList.toggle("d-none", view !== "table");
  if (toggleBtn) toggleBtn.textContent = view === "table" ? "Ver cards" : "Ver tabela";
}

function setActionButtons(enabled) {
  const ids = [
    "bracketBtn",
    "rrBtn",
    "copyBtn",
    "shareBtn",
    "toggleViewBtn",
    "shareTextBtn",
    "shareResultPngBtn",
    "shareBracketPngBtn",
    "swapHomeBtn"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

async function copyResult() {
  if (!lastDraw) return;
  const lines = (lastDraw.draw || []).map((row) => {
    const label = categoryLabel(row.team_type, row.gender);
    return `${row.participant};${row.team_name};${label};${row.overall}`;
  });
  const text = ["PARTICIPANTE;TIME;CATEGORIA;OVR", ...lines].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showError("N\u00e3o foi poss\u00edvel copiar. Verifique as permiss\u00f5es do navegador.");
  }
}

function exportCsv() {
  if (!lastDraw) return;
  const lines = (lastDraw.draw || []).map((row) => {
    const label = categoryLabel(row.team_type, row.gender);
    return `${row.participant};${row.team_name};${label};${row.overall};${row.attack};${row.midfield};${row.defence}`;
  });
  const text = ["PARTICIPANTE;TIME;CATEGORIA;OVR;ATT;MID;DEF", ...lines].join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sorteio.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportPng() {
  if (!lastDraw) return;
  const target = document.getElementById("shareCapture");
  if (!target || typeof html2canvas === "undefined") {
    showError("PNG indispon\u00edvel no momento.");
    return;
  }
  try {
    const canvas = await html2canvas(target, { backgroundColor: null, scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sorteio.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  } catch {
    showError("Falha ao gerar PNG.");
  }
}

async function exportXlsx() {
  if (!lastDraw) return;
  clearError();
  try {
    const r = await fetch("/api/export_xlsx", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(lastDraw)
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showError(j.error || "Erro ao exportar.");
      return;
    }
    const blob = await r.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sorteio.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    showError("Falha ao exportar.");
  }
}

async function shareLink() {
  if (!lastDraw) return;
  clearError();
  try {
    const meta = lastDraw.meta || {};
    const label = lastDraw.dataset === "nba" ? "NBA 2K" : "EA FC";
    const balanceLabel = meta.balance_mode === "tiers" ? "tiers A/B/C/D" : "aleat\u00f3rio";
    const repeatLabel = meta.avoid_repeat ? `sem repeti\u00e7\u00e3o (${meta.avoid_repeat_window || 1})` : "repeti\u00e7\u00e3o liberada";
    const lines = (lastDraw.draw || []).map((row) => {
      const label = categoryLabel(row.team_type, row.gender);
      return `${row.participant} - ${row.team_name} (${label})`;
    });
    const text = [
      `Sorteio de Times - ${label}`,
      `Data: ${meta.timestamp ? new Date(meta.timestamp).toLocaleString() : new Date().toLocaleString()}`,
      `Seed: ${meta.seed || "N/A"} | Balanceamento: ${balanceLabel} | ${repeatLabel}`,
      "",
      ...lines
    ].join("\n");
    await navigator.clipboard.writeText(text);
  } catch {
    showError("N\u00e3o foi poss\u00edvel copiar o texto.");
  }
}

async function exportResultPng() {
  if (!lastDraw) return;
  const target = document.getElementById("step-sorteio");
  if (!target || typeof html2canvas === "undefined") {
    showError("PNG indispon\u00edvel no momento.");
    return;
  }
  try {
    const canvas = await html2canvas(target, { backgroundColor: null, scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sorteio.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  } catch {
    showError("Falha ao gerar PNG.");
  }
}

async function exportBracketPng() {
  const target = document.getElementById("step-chaveamento");
  if (!target || typeof html2canvas === "undefined") {
    showError("PNG indispon?vel no momento.");
    return;
  }
  try {
    const canvas = await html2canvas(target, { backgroundColor: null, scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chaveamento.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  } catch {
    showError("Falha ao gerar PNG.");
  }
}

async function runRoundRobin() {
  if (!lastDraw) return;
  clearError();
  try {
    const rr = await fetch("/api/round_robin", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ draw: lastDraw.draw || [] })
    }).then((r) => r.json());
    renderRoundRobin(rr);
  } catch {
    showError("Erro ao gerar todos contra todos.");
  }
}

function setupProLinks() {
  const links = document.querySelectorAll(".js-pro-link");
  links.forEach((el) => {
    const custom = el.getAttribute("data-whatsapp");
    const href = custom && custom.trim() ? custom.trim() : PRO_DEFAULT_URL;
    el.setAttribute("href", href);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener");
  });
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((item, idx) => {
    item.style.transitionDelay = `${idx * 60}ms`;
    observer.observe(item);
  });
}

function applyThemeMode(mode) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("theme-dark", mode === "dark");
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = mode === "dark" ? "Tema claro" : "Tema escuro";
}

function applyTvMode(enabled) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("tv-mode", enabled);
  const btn = document.getElementById("tvToggleBtn");
  if (btn) btn.textContent = enabled ? "Sair do TV" : "Modo TV";
  if (enabled) setActiveTab("sorteio");
}

function updateRoomStatus(code) {
  const status = document.getElementById("roomStatus");
  if (!status) return;
  status.textContent = code ? `Sala local: ${code}` : "";
  if (code && navigator.clipboard) {
    navigator.clipboard.writeText(code).catch(() => {});
  }
}

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

const participantInput = document.getElementById("participantInput");
const addParticipantBtn = document.getElementById("addParticipantBtn");
if (addParticipantBtn && participantInput) {
  addParticipantBtn.addEventListener("click", () => {
    const name = normalizeName(participantInput.value);
    if (!name) return;
    const exists = participants.some((p) => p.toLowerCase() === name.toLowerCase());
    if (exists) {
      showError("Participante duplicado.");
      return;
    }
    participants.push(name);
    participantInput.value = "";
    renderParticipants();
  });

  participantInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addParticipantBtn.click();
  });
}

const importBtn = document.getElementById("importBtn");
if (importBtn) {
  importBtn.addEventListener("click", () => {
    const bulk = document.getElementById("bulkInput");
    if (!bulk) return;
    const lines = (bulk.value || "")
      .split(/\r?\n/)
      .map((s) => normalizeName(s))
      .filter(Boolean);
    const before = participants.length;
    const unique = new Set();
    lines.forEach((name) => {
      const key = name.toLowerCase();
      if (unique.has(key)) return;
      unique.add(key);
      const exists = participants.some((p) => p.toLowerCase() === key);
      if (!exists) participants.push(name);
    });
    const added = participants.length - before;
    const dupes = lines.length - unique.size;
    const feedback = document.getElementById("bulkFeedback");
    if (feedback) {
      feedback.textContent = `${lines.length} nomes detectados \u00b7 ${dupes} duplicados removidos \u00b7 ${added} adicionados`;
    }
    bulk.value = "";
    renderParticipants();
  });
}

const liveModeToggle = document.getElementById("liveModeToggle");
if (liveModeToggle) {
  liveModeToggle.checked = getStorageBool("liveMode", false);
  liveModeToggle.addEventListener("change", () => {
    setStorageBool("liveMode", liveModeToggle.checked);
  });
}

const bulkInput = document.getElementById("bulkInput");
if (bulkInput) {
  bulkInput.addEventListener("input", () => {
    updateBulkFeedback(bulkInput.value);
  });
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == "v") {
    if (participants.length === 0) {
      const details = document.getElementById("pasteDetails");
      const bulk = document.getElementById("bulkInput");
      if (details && bulk) {
        details.open = true;
        bulk.focus();
      }
    }
  }
});

const pasteBtn = document.getElementById("pasteBtn");
if (pasteBtn) {
  pasteBtn.addEventListener("click", async () => {
    if (!navigator.clipboard?.readText) {
      showError("Clipboard indispon\u00edvel no navegador.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const lines = String(text || "")
        .split(/[\r\n,;]+/)
        .map((s) => normalizeName(s))
        .filter(Boolean);
      lines.forEach((name) => {
        const exists = participants.some((p) => p.toLowerCase() === name.toLowerCase());
        if (!exists) participants.push(name);
      });
      renderParticipants();
    } catch {
      showError("Não foi possível acessar o clipboard.");
    }
  });
}

const undoBtn = document.getElementById("undoBtn");
if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    if (!lastRemoved) return;
    const exists = participants.some((p) => p.toLowerCase() === lastRemoved.toLowerCase());
    if (!exists) participants.push(lastRemoved);
    lastRemoved = null;
    renderParticipants();
  });
}

const sortParticipantsBtn = document.getElementById("sortParticipantsBtn");
if (sortParticipantsBtn) {
  sortParticipantsBtn.addEventListener("click", () => {
    participants.sort((a, b) => a.localeCompare(b));
    renderParticipants();
  });
}

const clearBtn = document.getElementById("clearParticipantsBtn");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    participants.length = 0;
    lastRemoved = null;
    renderParticipants();
  });
}

const newSeasonBtn = document.getElementById("newSeasonBtn");
if (newSeasonBtn) {
  newSeasonBtn.addEventListener("click", () => {
    lastDraw = null;
    resetBracket();
    const cards = document.getElementById("resultCards");
    if (cards) cards.innerHTML = "";
    const resultMeta = document.getElementById("resultMeta");
    if (resultMeta) resultMeta.textContent = "";
    setActionButtons(false);
  });
}

const nextRoundBtn = document.getElementById("nextRoundBtn");
if (nextRoundBtn) {
  nextRoundBtn.addEventListener("click", () => {
    const lastIndex = bracketState.rounds.length - 1;
    if (lastIndex >= 0) {
      maybeAdvance(lastIndex);
    }
  });
}

const datasetFc25Btn = document.getElementById("datasetFc25Btn");
if (datasetFc25Btn) {
  datasetFc25Btn.addEventListener("click", () => setDataset("fc25"));
}

const datasetNbaBtn = document.getElementById("datasetNbaBtn");
if (datasetNbaBtn) {
  datasetNbaBtn.addEventListener("click", () => setDataset("nba"));
}

const presetSelect = document.getElementById("presetSelect");
function fillPresetsForDataset(dataset) {
  if (!presetSelect) return;
  const options = [];
  Object.entries(presets).forEach(([key, val]) => {
    if (!val.dataset || val.dataset === dataset) {
      options.push({ key, label: themeCopy[key]?.title || key });
    }
  });
  presetSelect.innerHTML = "";
  options.forEach((opt, idx) => {
    const o = document.createElement("option");
    o.value = opt.key;
    o.textContent = opt.label;
    presetSelect.appendChild(o);
  });
  presetSelect.value = options[0]?.key || "";
  applyPreset(presetSelect.value);
}
if (presetSelect) {
  presetSelect.addEventListener("change", (e) => {
    applyPreset(e.target.value);
    toggleTopN();
  });
}

const modeSelect = document.getElementById("modeSelect");
if (modeSelect) {
  modeSelect.addEventListener("change", () => {
    toggleTopN();
    syncModeCategory();
  });
}

themeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.getAttribute("data-theme");
    setTheme(theme);
  });
});

const drawBtn = document.getElementById("drawBtn");
if (drawBtn) {
  drawBtn.addEventListener("click", async () => {
    clearError();
    const modeSelection = document.getElementById("modeSelect").value;
  const mode = modeSelection === "top" ? "top" : "all";
  const topN = parseInt(document.getElementById("topNInput").value || "10", 10);
  const category = document.getElementById("categorySelect").value;
  const balanceMode = document.getElementById("balanceSelect")?.value || "overall";
  const avoidRepeat = Boolean(document.getElementById("avoidRepeatToggle")?.checked);
  const avoidRepeat3 = Boolean(document.getElementById("avoidRepeat3Toggle")?.checked);
  const seedValue = generateSeed();

    if (participants.length === 0) {
      showError("Adicione ao menos 1 participante.");
      return;
    }

    try {
      let exclude = [];
      if (avoidRepeat || avoidRepeat3) {
        const history = JSON.parse(localStorage.getItem("lastDrawTeamsHistory") || "[]");
        const flatHistory = history.flat();
        const stored = JSON.parse(localStorage.getItem("lastDrawTeams") || "[]");
        exclude = avoidRepeat3 ? flatHistory : stored;
        if (!exclude.length && lastDraw?.draw) {
          exclude = lastDraw.draw.map((row) => row.team_id).filter(Boolean);
        }
      }

      const r = await fetch("/api/draw", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          dataset: datasetState.current,
          participants,
          mode,
          top_n: topN,
          category,
          balance_mode: balanceMode,
          avoid_repeat: avoidRepeat || avoidRepeat3,
          avoid_repeat_window: avoidRepeat3 ? 3 : 1,
          exclude_team_ids: exclude,
          seed: seedValue
        })
      });

      const j = await r.json();
      if (!r.ok) {
        showError(j.error || "Erro ao sortear.");
        return;
      }

      lastDraw = j;
      const used = (j.draw || []).map((row) => row.team_id).filter(Boolean);
      localStorage.setItem("lastDrawTeams", JSON.stringify(used));
      const history = JSON.parse(localStorage.getItem("lastDrawTeamsHistory") || "[]");
      history.unshift(used);
      localStorage.setItem("lastDrawTeamsHistory", JSON.stringify(history.slice(0, 3)));
      renderResults(j, seedValue);
      buildBracket(j.draw);
      setActiveTab("sorteio");

    } catch (e) {
      showError("Falha de comunicação com o servidor.");
    }
  });
}

const bracketBtn = document.getElementById("bracketBtn");
if (bracketBtn) bracketBtn.addEventListener("click", () => {
  if (lastDraw) {
    buildBracket(lastDraw.draw || []);
    setActiveTab("chaveamento");
  }
});

const rrBtn = document.getElementById("rrBtn");
if (rrBtn) rrBtn.addEventListener("click", () => {
  runRoundRobin();
  setActiveTab("chaveamento");
});

const copyBtn = document.getElementById("copyBtn");
if (copyBtn) copyBtn.addEventListener("click", shareLink);

const csvBtn = document.getElementById("csvBtn");
if (csvBtn) csvBtn.addEventListener("click", exportCsv);

const pngBtn = document.getElementById("pngBtn");
if (pngBtn) pngBtn.addEventListener("click", exportPng);

const exportBtn = document.getElementById("exportBtn");
if (exportBtn) exportBtn.addEventListener("click", exportXlsx);

const shareBtn = document.getElementById("shareBtn");
if (shareBtn) shareBtn.addEventListener("click", copyResult);

const toggleViewBtn = document.getElementById("toggleViewBtn");
if (toggleViewBtn) {
  toggleViewBtn.addEventListener("click", () => {
    setResultView(resultView === "table" ? "cards" : "table");
  });
}

const shareTextBtn = document.getElementById("shareTextBtn");
if (shareTextBtn) shareTextBtn.addEventListener("click", shareLink);

const shareResultPngBtn = document.getElementById("shareResultPngBtn");
if (shareResultPngBtn) shareResultPngBtn.addEventListener("click", exportResultPng);

const shareBracketPngBtn = document.getElementById("shareBracketPngBtn");
if (shareBracketPngBtn) shareBracketPngBtn.addEventListener("click", exportBracketPng);

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const tvToggleBtn = document.getElementById("tvToggleBtn");

if (createRoomBtn) {
  createRoomBtn.addEventListener("click", () => {
    const code = generateRoomCode();
    localStorage.setItem("roomCode", code);
    updateRoomStatus(code);
    alert(`Sala criada: ${code}\\nUse este c\u00f3digo para compartilhar.`);
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    const code = prompt("Digite o c\u00f3digo da sala");
    if (!code) return;
    localStorage.setItem("roomCode", code.trim().toUpperCase());
    updateRoomStatus(code.trim().toUpperCase());
    alert(`Entrou na sala: ${code.trim().toUpperCase()}`);
  });
}

if (themeToggleBtn) {
  const saved = localStorage.getItem("themeMode") || "light";
  applyThemeMode(saved);
  themeToggleBtn.addEventListener("click", () => {
    const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
    localStorage.setItem("themeMode", next);
    applyThemeMode(next);
  });
} else {
  const saved = localStorage.getItem("themeMode") || "light";
  applyThemeMode(saved);
}

if (tvToggleBtn) {
  const saved = getStorageBool("tvMode", false);
  applyTvMode(saved);
  tvToggleBtn.addEventListener("click", () => {
    const next = !document.body.classList.contains("tv-mode");
    setStorageBool("tvMode", next);
    applyTvMode(next);
    if (next) setActiveTab("sorteio");
  });
}

updateRoomStatus(localStorage.getItem("roomCode") || "");

const swapHomeBtn = document.getElementById("swapHomeBtn");
if (swapHomeBtn) swapHomeBtn.addEventListener("click", swapHomeAway);

window.addEventListener("resize", drawBracketLines);

setDataset("fc25");
fillPresetsForDataset("fc25");
renderParticipants();
renderBracket();
setupProLinks();
setupReveal();
setTheme("champions");
applyPreset(presetSelect?.value || "champions");
setActiveTab("jogadores");
disableFutureTabs();
