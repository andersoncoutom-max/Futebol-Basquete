let participants = [];
let clientId = null;
let isPro = false;
let pendingFeature = null;
let pendingAction = null;
let lastDrawPayload = null;
let datasets = [];
let currentDataset = "fc25";

function byId(id){ return document.getElementById(id); }

function showError(msg){
  const box = byId("errorBox");
  box.textContent = msg;
  box.classList.remove("d-none");
}
function clearError(){
  const box = byId("errorBox");
  box.textContent = "";
  box.classList.add("d-none");
}

function loadLocal(){

  try{
    const cid = localStorage.getItem("sorteiospro_client_id");
    if (cid) {
      clientId = cid;
    } else {
      clientId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);
      localStorage.setItem("sorteiospro_client_id", clientId);
    }
  }catch{
    clientId = String(Math.random()).slice(2);
  }

  try{
    const raw = localStorage.getItem("sorteiospro_state");
    if(!raw) return;
    const st = JSON.parse(raw);
    participants = Array.isArray(st.participants) ? st.participants : [];
    currentDataset = st.dataset || "fc25";
    const theme = st.theme || "light";
    if(theme === "dark") document.body.classList.add("dark");
  }catch{}
}
function saveLocal(){
  try{
    const st = {participants, dataset: currentDataset, isPro, theme: document.body.classList.contains("dark") ? "dark" : "light"};
    localStorage.setItem("sorteiospro_state", JSON.stringify(st));
  }catch{}
}

function renderParticipants(){
  byId("participantsCount").textContent = String(participants.length);
  const ul = byId("participantsList");
  ul.innerHTML = "";
  participants.forEach((name, idx) => {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between align-items-center px-0";

    const span = document.createElement("span");
    span.textContent = name;

    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-outline-danger";
    btn.textContent = "Remover";
    btn.onclick = () => {
      participants.splice(idx, 1);
      saveLocal();
      renderParticipants();
  setProToggleUI();
    };

    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function getSelectedOptions(selectId){
  const el = byId(selectId);
  if(!el) return [];
  return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean);
}

function getFilters(){
  const overall_min = parseInt(byId("overallMin").value || "0", 10);
  const mode = byId("modeSelect").value;
  const top_n = parseInt(byId("topN").value || "20", 10);
  const include_invalid = byId("includeInvalid").checked;

  const filters = { overall_min, mode, top_n, include_invalid };

  const team_types = getSelectedOptions("teamTypeSelect");
  const genders = getSelectedOptions("genderSelect");
  const competitions = getSelectedOptions("competitionSelect");
  const countries = getSelectedOptions("countrySelect");
  if(team_types.length) filters.team_types = team_types;
  if(genders.length) filters.genders = genders;
  if(competitions.length) filters.competitions = competitions;
  if(countries.length) filters.countries = countries;

  const conferences = getSelectedOptions("conferenceSelect");
  const divisions = getSelectedOptions("divisionSelect");
  if(conferences.length) filters.conferences = conferences;
  if(divisions.length) filters.divisions = divisions;

  return filters;
}

async function fetchJSON(url, payload){
  const opt = payload ? {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  } : { method: "GET" };

  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if(!r.ok){
    throw new Error(j.error || `Erro HTTP ${r.status}`);
  }
  return j;
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPool(sample, count){
  byId("poolCount").textContent = String(count);
  byId("poolCount2").textContent = String(count);

  const tbody = byId("poolTbody");
  tbody.innerHTML = "";
  sample.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.team_name)}</td>
      <td>${t.overall ?? ""}</td>
      <td>${t.attack ?? ""}</td>
      <td>${t.midfield ?? ""}</td>
      <td>${t.defence ?? ""}</td>
      <td class="col-min">${escapeHtml(t.team_type || "")}</td>
      <td class="col-min">${escapeHtml(t.gender || "")}</td>
      <td class="col-min">${escapeHtml(t.country || "")}</td>
      <td class="col-min">${escapeHtml(t.conference || "")}</td>
      <td class="col-min">${escapeHtml(t.division || "")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderResult(draw, poolCount){
  const tbody = byId("resultTbody");
  tbody.innerHTML = "";
  draw.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.participant)}</td>
      <td>${escapeHtml(r.team_name)}</td>
      <td>${r.overall ?? ""}</td>
      <td>${r.attack ?? r.offense ?? ""}</td>
      <td>${r.midfield ?? ""}</td>
      <td>${r.defence ?? r.defense ?? ""}</td>
    `;
    tbody.appendChild(tr);
  });

  byId("resultMeta").textContent = `Participantes: ${draw.length}. Pool: ${poolCount}. Dataset: ${currentDataset}.`;

  byId("copyBtn").disabled = draw.length === 0;
  byId("exportBtn").disabled = draw.length === 0;
  byId("bracketBtn").disabled = draw.length < 2;
  byId("rrBtn").disabled = draw.length < 2;

  byId("bracketBox").classList.add("d-none");
  byId("bracketRounds").innerHTML = "";
  byId("bracketMeta").textContent = "";
}

async function loadDatasets(){
  const j = await fetchJSON("/api/datasets");
  datasets = j.datasets || [];
  const sel = byId("datasetSelect");
  sel.innerHTML = "";
  datasets.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.key;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });
  sel.value = currentDataset;
}

function setFiltersVisible(){
  const isSoccer = currentDataset === "fc25";
  byId("filtersSoccer").classList.toggle("d-none", !isSoccer);
  byId("filtersBasket").classList.toggle("d-none", isSoccer);
}

async function loadFacets(){
  const j = await fetchJSON("/api/facets", { dataset: currentDataset });
  fillMulti("teamTypeSelect", j.team_types || []);
  fillMulti("genderSelect", j.genders || []);
  fillMulti("competitionSelect", (j.competitions || []).slice(0, 250));
  fillMulti("countrySelect", (j.countries || []).slice(0, 250));
  fillMulti("conferenceSelect", j.conferences || []);
  fillMulti("divisionSelect", j.divisions || []);
}

function fillMulti(id, items){
  const el = byId(id);
  if(!el) return;
  el.innerHTML = "";
  items.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

async function loadStats(){
  const j = await fetchJSON(`/api/stats?dataset=${encodeURIComponent(currentDataset)}`);
  byId("statsLine").textContent = `Válidos: ${j.valid_rows} de ${j.total_rows}. OVR ${j.min_overall} a ${j.max_overall}.`;
}

async function previewPool(){
  clearError();
  const filters = getFilters();
  try{
    const j = await fetchJSON("/api/pool_preview", { dataset: currentDataset, filters, limit: 30 });
    renderPool(j.sample || [], j.count || 0);
  }catch(e){
    showError(e.message || "Erro ao pré-visualizar.");
  }
}

async function doDraw(){
  clearError();
  const filters = getFilters();
  if (participants.length === 0){
    showError("Adicione ao menos 1 participante.");
    return;
  }
  try{
    const j = await fetchJSON("/api/draw", { dataset: currentDataset, participants, filters });
    lastDrawPayload = j;
    renderResult(j.draw || [], j.pool_count || 0);
    saveLocal();
  }catch(e){
    showError(e.message || "Erro ao sortear.");
  }
}

async function copyResult(){
  if (!lastDrawPayload) return;
  const lines = (lastDrawPayload.draw || []).map(r => `${r.participant};${r.team_name};${r.overall}`);
  const text = ["PARTICIPANTE;TIME;OVR", ...lines].join("\n");
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    showError("Não foi possível copiar. Verifique permissões do navegador.");
  }
}

async function exportExcelCore(){
  if (!lastDrawPayload) return;
  clearError();
  try{
    const r = await fetch("/api/export_xlsx", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(lastDrawPayload)
    });
    if (!r.ok){
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
  }catch{
    showError("Falha ao exportar.");
  }
}

function renderBracket(br){
  byId("rrBox").classList.add("d-none");
  byId("rrTbody").innerHTML = "";
  byId("rrMeta").textContent = "";

  const box = byId("bracketBox");
  box.classList.remove("d-none");

  byId("bracketMeta").textContent = `Tamanho do bracket: ${br.size}.`;
  const container = byId("bracketRounds");
  container.innerHTML = "";

  (br.rounds || []).forEach(rnd => {
    const card = document.createElement("div");
    card.className = "card card-soft mb-2";
    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "fw-semibold mb-2";
    title.textContent = `${rnd.name}`;

    body.appendChild(title);

    const list = document.createElement("div");
    list.className = "d-grid gap-2";

    (rnd.matches || []).forEach(m => {
      const a = m.a ? `${m.a.participant} (${m.a.team_name})` : "BYE";
      const b = m.b ? `${m.b.participant} (${m.b.team_name})` : "BYE";
      const row = document.createElement("div");
      row.className = "d-flex justify-content-between align-items-center p-2 rounded-3 border";
      row.innerHTML = `<span class="small">${escapeHtml(a)}</span><span class="mono small text-muted">vs</span><span class="small">${escapeHtml(b)}</span>`;
      list.appendChild(row);
    });

    body.appendChild(list);
    card.appendChild(body);
    container.appendChild(card);
  });
}

async function makeBracketCore(){
  if (!lastDrawPayload) return;
  clearError();
  try{
    const br = await fetchJSON("/api/bracket", { draw: lastDrawPayload.draw || [] });
    renderBracket(br);
  }catch(e){
    showError(e.message || "Erro ao gerar chaveamento.");
  }
}

function applyThemeToggle(){
  document.body.classList.toggle("dark");
  saveLocal();
}


function setProToggleUI(){
  const el = byId("proToggle");
  if (!el) return;
  el.checked = !!isPro;
}

function wireEvents(){
  byId("addParticipantBtn").addEventListener("click", () => {
    const input = byId("participantInput");
    const name = (input.value || "").trim();
    if (!name) return;
    participants.push(name);
    input.value = "";
    saveLocal();
    renderParticipants();
  });

  byId("participantInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      byId("addParticipantBtn").click();
    }
  });

  byId("importBtn").addEventListener("click", () => {
    const txt = byId("bulkInput").value || "";
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    lines.forEach(n => participants.push(n));
    byId("bulkInput").value = "";
    saveLocal();
    renderParticipants();
  });

  byId("clearParticipantsBtn").addEventListener("click", () => {
    participants = [];
    saveLocal();
    renderParticipants();
  });

  byId("overallMin").addEventListener("input", () => {
    byId("overallMinLabel").textContent = byId("overallMin").value;
  });

  byId("previewBtn").addEventListener("click", previewPool);
  byId("drawBtn").addEventListener("click", doDraw);
  byId("copyBtn").addEventListener("click", copyResult);
  byId("exportBtn").addEventListener("click", exportExcel);
  byId("bracketBtn").addEventListener("click", makeBracket);

  byId("datasetSelect").addEventListener("change", async (e) => {
    currentDataset = e.target.value;
    saveLocal();
    setFiltersVisible();
    await loadStats();
    await loadFacets();
    await previewPool();
  });

  byId("btnTheme").addEventListener("click", applyThemeToggle);

  byId("proToggle").addEventListener("change", (e) => {
    isPro = !!e.target.checked;
    saveLocal();
  });
}

async function init(){
  loadLocal();
  wireEvents();
  renderParticipants();
  await loadDatasets();
  setFiltersVisible();
  await loadStats();
  await loadFacets();

  byId("overallMinLabel").textContent = byId("overallMin").value;
  await previewPool();
}

init();

function renderRoundRobin(rr){
  const box = byId("rrBox");
  box.classList.remove("d-none");

  byId("rrMeta").textContent = `Participantes: ${rr.players}. Total de jogos: ${rr.total_matches}.`;
  const tbody = byId("rrTbody");
  tbody.innerHTML = "";

  (rr.matches || []).forEach((m, idx) => {
    const a = m.a || {};
    const b = m.b || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${idx+1}</td>
      <td>${escapeHtml(a.participant || "")}</td>
      <td>${escapeHtml(a.team_name || "")}</td>
      <td class="mono text-muted">vs</td>
      <td>${escapeHtml(b.participant || "")}</td>
      <td>${escapeHtml(b.team_name || "")}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function makeRoundRobinCore(){
  if (!lastDrawPayload) return;
  clearError();
  try{
    const rr = await fetchJSON("/api/round_robin", { draw: lastDrawPayload.draw || [] });
    // esconde bracket, mostra rr
    byId("bracketBox").classList.add("d-none");
    byId("bracketRounds").innerHTML = "";
    byId("bracketMeta").textContent = "";
    renderRoundRobin(rr);
  }catch(e){
    showError(e.message || "Erro ao gerar todos contra todos.");
  }
}


async function hasFeature(feature){
  if (isPro) return true;
  if (!clientId) return false;
  try{
    const j = await fetchJSON("/api/entitlement/check", { client_id: clientId, feature });
    return !!j.allowed;
  }catch{
    return false;
  }
}

function openRewarded(feature, actionFn){
  pendingFeature = feature;
  pendingAction = actionFn;

  const modalEl = byId("rewardedModal");
  const confirmBtn = byId("rewardedConfirmBtn");
  const countdownEl = byId("rewardedCountdown");
  const progressEl = byId("rewardedProgress");

  confirmBtn.disabled = true;

  let seconds = 10;
  countdownEl.textContent = String(seconds);
  progressEl.style.width = "0%";

  const tick = () => {
    seconds -= 1;
    const done = Math.max(0, seconds);
    countdownEl.textContent = String(done);
    const pct = Math.min(100, Math.round(((10 - done) / 10) * 100));
    progressEl.style.width = pct + "%";
    if (done <= 0){
      clearInterval(timer);
      confirmBtn.disabled = false;
    }
  };
  const timer = setInterval(tick, 1000);

  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  confirmBtn.onclick = async () => {
    clearError();
    confirmBtn.disabled = true;
    try{
      await fetchJSON("/api/entitlement/grant", { client_id: clientId, feature: pendingFeature, seconds: 900 });
      modal.hide();
      if (typeof pendingAction === "function"){
        pendingAction();
      }
    }catch(e){
      showError(e.message || "Falha ao desbloquear.");
      confirmBtn.disabled = false;
    }
  };
}

async function ensureFeature(feature, actionFn){
  const ok = await hasFeature(feature);
  if (ok){
    actionFn();
    return true;
  }
  openRewarded(feature, actionFn);
  return false;
}


async function exportExcel(){
  return ensureFeature("export_xlsx", exportExcelCore);
}

async function makeBracket(){
  return ensureFeature("bracket", makeBracketCore);
}

async function makeRoundRobin(){
  // todos contra todos também pode ser premium se você quiser, mas deixei como gated no mesmo padrão
  return ensureFeature("round_robin", makeRoundRobinCore);
}
