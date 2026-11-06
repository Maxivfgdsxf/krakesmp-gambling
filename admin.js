
// ==========================================
// KRAKESMP - OWNER PANEL
// ==========================================

let editingRoundId = null;

async function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    return showMessage("Bitte Zugangsdaten eingeben!");
  }

  const { error } = await db.auth.signInWithPassword({
    email, password
  });

  if (error) return showMessage(error.message);

  const { data, error: adminError } =
    await db.rpc("krake_is_admin");

  if (adminError || data !== true) {
    await db.auth.signOut();
    return showMessage("Kein Owner-Zugriff!");
  }

  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  await loadAdminData();
}

// ==========================================
// DATEN LADEN
// ==========================================

async function loadAdminData() {
  const { data: players, error } = await db
    .from("ks_players")
    .select("*")
    .order("total_profit", { ascending: false });

  if (error) return showMessage(error.message);

  const { data: rounds, error: roundError } = await db
    .from("ks_rounds")
    .select("*")
    .order("created_at", { ascending: false });

  if (roundError) return showMessage(roundError.message);

  const allPlayers = players || [];
  const allRounds = rounds || [];

  document.getElementById("playerCount").textContent =
    allPlayers.length;

  document.getElementById("totalTurnover").textContent =
    money(allRounds.reduce((s, r) => s + Number(r.stake || 0), 0));

  document.getElementById("roundUser").innerHTML =
    allPlayers.map(p => `
      <option value="${p.id}">
        ${escapeHTML(p.username)}
      </option>
    `).join("");

  document.getElementById("players").innerHTML =
    allPlayers.map(p => {
      const wins = Number(p.total_wins || 0);
      const losses = Number(p.total_losses || 0);
      const total = wins + losses;
      const rate = total ? wins / total * 100 : 0;

      return `
        <div class="player">
          <b>${escapeHTML(p.username)}</b>
          <p>Runden: ${p.total_rounds}</p>
          <p>Siege: ${wins} | Niederlagen: ${losses}</p>
          <p>Winrate: ${rate.toFixed(1)}%</p>
          <p>Profit: ${money(p.total_profit)}</p>
        </div>
      `;
    }).join("") || "Keine Spieler.";

  document.getElementById("roundList").innerHTML =
    allRounds.slice(0, 50).map(r => {
      const player = allPlayers.find(p => p.id === r.user_id);

      return `
        <div class="player">
          <b>${escapeHTML(player?.username || "Unbekannt")}</b>
          <p>${escapeHTML(r.game_name)}</p>
          <p>Einsatz: ${money(r.stake)}</p>
          <p>Ergebnis: ${money(r.result)}</p>
          <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>
          <button onclick="editRound(${r.id})">BEARBEITEN</button>
          <button class="danger" onclick="deleteRound(${r.id})">LÖSCHEN</button>
        </div>
      `;
    }).join("") || "Noch keine Einträge.";
}

// ==========================================
// RUNDE SPEICHERN
// ==========================================

async function addRound() {
  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();
  const stake = Number(document.getElementById("stake").value);
  const resultText = document.getElementById("result").value;
  const result = Number(resultText);
  const won = document.getElementById("won").value === "true";

  if (!userId || !gameName ||
      !Number.isSafeInteger(stake) || stake < 0 ||
      resultText === "" || !Number.isSafeInteger(result)) {
    return showMessage("Bitte gültige Werte eingeben!");
  }

  const { error } = await db.from("ks_rounds").insert({
    user_id: userId,
    game_name: gameName,
    stake,
    result,
    won
  });

  if (error) return showMessage(error.message);

  resetRoundForm();
  showMessage("Statistik gespeichert!");
  await loadAdminData();
}

// ==========================================
// RUNDE BEARBEITEN
// ==========================================

async function editRound(id) {
  const { data, error } = await db
    .from("ks_rounds")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return showMessage(error.message);

  editingRoundId = id;

  document.getElementById("roundUser").value = data.user_id;
  document.getElementById("gameName").value = data.game_name;
  document.getElementById("stake").value = data.stake;
  document.getElementById("result").value = data.result;
  document.getElementById("won").value = String(data.won);

  document.getElementById("saveRoundButton").textContent =
    "ÄNDERUNGEN SPEICHERN";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ==========================================
// ÄNDERUNGEN SPEICHERN
// ==========================================

async function saveRound() {
  if (!editingRoundId) return addRound();

  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();
  const stake = Number(document.getElementById("stake").value);
  const resultText = document.getElementById("result").value;
  const result = Number(resultText);
  const won = document.getElementById("won").value === "true";

  if (!userId || !gameName ||
      !Number.isSafeInteger(stake) || stake < 0 ||
      resultText === "" || !Number.isSafeInteger(result)) {
    return showMessage("Ungültige Eingaben!");
  }

  const { error } = await db
    .from("ks_rounds")
    .update({
      user_id: userId,
      game_name: gameName,
      stake,
      result,
      won
    })
    .eq("id", editingRoundId);

  if (error) return showMessage(error.message);

  resetRoundForm();
  showMessage("Statistik aktualisiert!");
  await loadAdminData();
}

// ==========================================
// FORMULAR ZURÜCKSETZEN
// ==========================================

function resetRoundForm() {
  editingRoundId = null;

  document.getElementById("gameName").value = "";
  document.getElementById("stake").value = "";
  document.getElementById("result").value = "";

  document.getElementById("saveRoundButton").textContent =
    "STATISTIK SPEICHERN";
}

// ==========================================
// RUNDE LÖSCHEN
// ==========================================

async function deleteRound(id) {
  if (!confirm("Statistik wirklich löschen?")) return;

  const { error } = await db
    .from("ks_rounds")
    .delete()
    .eq("id", id);

  if (error) return showMessage(error.message);

  showMessage("Statistik gelöscht!");
  await loadAdminData();
}

// ==========================================
// ABMELDEN
// ==========================================

async function adminLogout() {
  await db.auth.signOut();
  location.href = "index.html";
}
