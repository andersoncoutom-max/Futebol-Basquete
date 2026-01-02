
const participants = [];
let lastDraw = null;

const PRO_DEFAULT_URL = "https://wa.me/55SEU_NUMERO?text=Quero%20assinar%20o%20Sorteio%20Pro";

const datasetState = {
  current: "fc25"
};

const bracketState = {
  rounds: [],
  pendingByes: []
};

const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll(".tab-panel");

function setActiveTab(tabId) {
  if (!tabButtons.length || !tabPanels.length) return;
  tabButtons.forEach((btn) => {
    const target = btn.getAttribute("data-tab-target");
    btn.classList.toggle("active", target === tabId);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-tab") === tabId);
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-tab-target");
    if (target) setActiveTab(target);
  });
});

function normalizeName(name) {
  return String(name || "").trim();
}

function renderParticipants() {
  const ul = document.getElementById("participantsList");
  const count = document.getElementById("participantCount");
  if (count) count.textContent = String(participants.length);

  ul.innerHTML = "";

  participants.forEach((name, idx) => {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between align-items-center";

    const span = document.createElement("span");
    span.textContent = name;

    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-outline-light";
    btn.textContent = "Remover";
    btn.onclick = () => {
      participants.splice(idx, 1);
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

  if (t === "NATIONAL" && g === "WOMEN") return "Selecoes femininas";
  if (t === "NATIONAL" && g === "MEN") return "Selecoes masculinas";
  if (t === "CLUB" && g === "WOMEN") return "Clubes femininos";
  if (t === "CLUB" && g === "MEN") return "Clubes masculinos";
  if (t === "NATIONAL") return "Selecoes";
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

      card.appendChild(header);
      card.appendChild(aBtn);
      card.appendChild(vs);
      card.appendChild(bBtn);
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
    options.push({ value: "national", label: "Selecoes (todas)" });
    options.push({ value: "national_men", label: "Selecoes masculinas" });
    options.push({ value: "national_women", label: "Selecoes femininas" });
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
    labelNational.textContent = "Selecoes";
  }
}

async function loadTeamsInfo() {
  try {
    const r = await fetch(`/api/teams_info?dataset=${datasetState.current}`);
    const j = await r.json();
    const el = document.getElementById("teamsInfo");
    el.textContent = `Base: ${j.total_teams} | OVR min: ${j.min_overall} | OVR max: ${j.max_overall}`;
    updateStatsLabels(j);
  } catch {
    // silencioso
  }
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
  loadTeamsInfo();
  resetBracket();

  const rrBox = document.getElementById("rrBox");
  if (rrBox) rrBox.classList.add("d-none");

  const tbody = document.getElementById("resultTbody");
  if (tbody) {
    tbody.innerHTML = "";
  }
  lastDraw = null;
  setActionButtons(false);
}

function setActionButtons(enabled) {
  const ids = ["bracketBtn", "rrBtn", "copyBtn", "csvBtn", "pngBtn", "exportBtn", "shareBtn"];
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
    showError("Nao foi possivel copiar. Verifique as permissoes do navegador.");
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
    showError("PNG indisponivel no momento.");
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
    const r = await fetch("/api/share", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(lastDraw)
    });
    const j = await r.json();
    if (!r.ok) {
      showError(j.error || "Erro ao compartilhar.");
      return;
    }
    const url = j.url || window.location.href;
    await navigator.clipboard.writeText(url);
  } catch {
    showError("Nao foi possivel copiar o link.");
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
    lines.forEach((name) => {
      const exists = participants.some((p) => p.toLowerCase() === name.toLowerCase());
      if (!exists) participants.push(name);
    });
    bulk.value = "";
    renderParticipants();
  });
}

const clearBtn = document.getElementById("clearParticipantsBtn");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    participants.length = 0;
    renderParticipants();
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

const drawBtn = document.getElementById("drawBtn");
if (drawBtn) {
  drawBtn.addEventListener("click", async () => {
    clearError();
    const mode = document.getElementById("modeSelect").value;
    const topN = parseInt(document.getElementById("topNInput").value || "10", 10);
    const category = document.getElementById("categorySelect").value;

    if (participants.length === 0) {
      showError("Adicione ao menos 1 participante.");
      return;
    }

    try {
      const r = await fetch("/api/draw", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          dataset: datasetState.current,
          participants,
          mode,
          top_n: topN,
          category
        })
      });

      const j = await r.json();
      if (!r.ok) {
        showError(j.error || "Erro ao sortear.");
        return;
      }

      lastDraw = j;
      setActionButtons(true);

      const tbody = document.getElementById("resultTbody");
      tbody.innerHTML = "";
      j.draw.forEach((row) => {
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

      buildBracket(j.draw);
      setActiveTab("resultados");

    } catch (e) {
      showError("Falha de comunicacao com o servidor.");
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
if (copyBtn) copyBtn.addEventListener("click", copyResult);

const csvBtn = document.getElementById("csvBtn");
if (csvBtn) csvBtn.addEventListener("click", exportCsv);

const pngBtn = document.getElementById("pngBtn");
if (pngBtn) pngBtn.addEventListener("click", exportPng);

const exportBtn = document.getElementById("exportBtn");
if (exportBtn) exportBtn.addEventListener("click", exportXlsx);

const shareBtn = document.getElementById("shareBtn");
if (shareBtn) shareBtn.addEventListener("click", shareLink);

window.addEventListener("resize", drawBracketLines);

setDataset("fc25");
renderParticipants();
renderBracket();
setupProLinks();
setupReveal();
setActiveTab("sorteio");
