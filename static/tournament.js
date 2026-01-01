(() => {
  const el = (id) => document.getElementById(id);
  const state = {
    code: null,
    tournament: null,
    players: [],
    matches: [],
  };

  const createName = el("createName");
  const createDataset = el("createDataset");
  const createMode = el("createMode");
  const createDisplay = el("createDisplay");
  const createBtn = el("createBtn");
  const joinCode = el("joinCode");
  const joinDisplay = el("joinDisplay");
  const joinBtn = el("joinBtn");
  const tournamentName = el("tournamentName");
  const tournamentMeta = el("tournamentMeta");
  const playersList = el("playersList");
  const matchesList = el("matchesList");
  const errorBox = el("errorBox");
  const copyCodeBtn = el("copyCodeBtn");
  const startBtn = el("startBtn");
  const startMode = el("startMode");

  const socket = io();

  const modeLabel = (mode) => (mode === "round_robin" ? "Todos contra todos" : "Mata-mata");
  const datasetLabel = (dataset) => (dataset === "nba" ? "NBA 2K25" : "FC 25");

  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.classList.remove("d-none");
  };

  const clearError = () => {
    errorBox.textContent = "";
    errorBox.classList.add("d-none");
  };

  const api = async (path, options = {}) => {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Erro na requisicao");
    }
    return data;
  };

  const updatePanel = () => {
    if (!state.tournament) {
      tournamentName.textContent = "Nenhum torneio carregado";
      tournamentMeta.textContent = "Use os cards acima para criar ou entrar.";
      playersList.innerHTML = "";
      matchesList.innerHTML = "";
      copyCodeBtn.disabled = true;
      startBtn.disabled = true;
      return;
    }

    const tournament = state.tournament;
    tournamentName.textContent = tournament.name;
    tournamentMeta.textContent = `Codigo ${tournament.code} | Jogo ${datasetLabel(tournament.dataset)} | Modo ${modeLabel(tournament.mode)} | Jogadores ${state.players.length}`;
    startMode.value = tournament.mode || "bracket";
    copyCodeBtn.disabled = false;
    startBtn.disabled = false;

    playersList.innerHTML = "";
    state.players.forEach((player) => {
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.textContent = player.display_name;
      playersList.appendChild(li);
    });

    if (!state.matches.length) {
      matchesList.innerHTML = '<div class="muted">Nenhuma partida gerada ainda.</div>';
      return;
    }

    const rounds = new Map();
    state.matches.forEach((match) => {
      if (!rounds.has(match.round_index)) {
        rounds.set(match.round_index, []);
      }
      rounds.get(match.round_index).push(match);
    });

    matchesList.innerHTML = "";
    [...rounds.keys()].sort((a, b) => a - b).forEach((round) => {
      const header = document.createElement("div");
      header.className = "match-title";
      header.textContent = `Rodada ${round}`;
      matchesList.appendChild(header);

      rounds.get(round).forEach((match) => {
        const card = document.createElement("div");
        card.className = "match-card";
        const winnerName = match.winner === "a" ? match.a_player : match.winner === "b" ? match.b_player : "-";
        const confirmations = [];
        if (match.confirmed_by_admin) confirmations.push("admin");
        if (match.confirmed_by_a) confirmations.push("A");
        if (match.confirmed_by_b) confirmations.push("B");
        const confirmText = confirmations.length ? `Confirmado: ${confirmations.join(", ")}` : "Aguardando confirmacao";

        card.innerHTML = `
          <div class="match-line"><strong>${match.a_player || "A definir"}</strong> <span class="muted">(${match.a_team || ""})</span></div>
          <div class="match-line"><strong>${match.b_player || "A definir"}</strong> <span class="muted">(${match.b_team || ""})</span></div>
          <div class="muted small">Vencedor: ${winnerName}</div>
          <div class="muted small">${confirmText}</div>
        `;

        const actions = document.createElement("div");
        actions.className = "match-actions";

        const btnA = document.createElement("button");
        btnA.className = "btn btn-ghost btn-sm";
        btnA.textContent = "Confirmar A";
        btnA.disabled = !match.a_player || (match.winner && match.winner !== "a");
        btnA.addEventListener("click", () => confirmMatch(match.id, "a"));

        const btnB = document.createElement("button");
        btnB.className = "btn btn-ghost btn-sm";
        btnB.textContent = "Confirmar B";
        btnB.disabled = !match.b_player || (match.winner && match.winner !== "b");
        btnB.addEventListener("click", () => confirmMatch(match.id, "b"));

        actions.appendChild(btnA);
        actions.appendChild(btnB);
        card.appendChild(actions);
        matchesList.appendChild(card);
      });
    });
  };

  const loadTournament = async (code) => {
    clearError();
    const data = await api(`/api/tournaments/${code}`);
    state.code = data.tournament.code;
    state.tournament = data.tournament;
    state.players = data.players || [];
    state.matches = data.matches || [];
    localStorage.setItem("tournamentCode", state.code);
    socket.emit("join_tournament", { code: state.code });
    updatePanel();
  };

  const confirmMatch = async (matchId, winner) => {
    if (!state.code) return;
    try {
      await api(`/api/tournaments/${state.code}/confirm`, {
        method: "POST",
        body: JSON.stringify({ match_id: matchId, winner }),
      });
      await loadTournament(state.code);
    } catch (err) {
      showError(err.message);
    }
  };

  createBtn.addEventListener("click", async () => {
    try {
      clearError();
      const payload = {
        name: createName.value.trim(),
        dataset: createDataset.value,
        mode: createMode.value,
        display_name: createDisplay.value.trim(),
      };
      const data = await api("/api/tournaments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      joinCode.value = data.code;
      await loadTournament(data.code);
    } catch (err) {
      showError(err.message);
    }
  });

  joinBtn.addEventListener("click", async () => {
    try {
      clearError();
      const payload = {
        code: joinCode.value.trim().toUpperCase(),
        display_name: joinDisplay.value.trim(),
      };
      const data = await api("/api/tournaments/join", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadTournament(data.code);
    } catch (err) {
      showError(err.message);
    }
  });

  copyCodeBtn.addEventListener("click", async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      copyCodeBtn.textContent = "Copiado!";
      setTimeout(() => (copyCodeBtn.textContent = "Copiar codigo"), 1400);
    } catch (err) {
      showError("Nao foi possivel copiar.");
    }
  });

  startBtn.addEventListener("click", async () => {
    if (!state.code) return;
    try {
      clearError();
      await api(`/api/tournaments/${state.code}/start`, {
        method: "POST",
        body: JSON.stringify({ mode: startMode.value }),
      });
      await loadTournament(state.code);
    } catch (err) {
      showError(err.message);
    }
  });

  socket.on("tournament_update", (payload) => {
    if (payload.code && payload.code === state.code) {
      loadTournament(state.code).catch(() => {});
    }
  });

  const saved = localStorage.getItem("tournamentCode");
  if (saved) {
    loadTournament(saved).catch(() => {});
  }

  updatePanel();
})();
