javascript
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
    email,
    password
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

  document.getElementById("status").textContent = "OWNER AKTIV";

  await loadAdminData();
}

// ==========================================
// DATEN LADEN
// ==========================================

async function loadAdminData() {
  const { data: players, error } = await db
    .from("ks_players")
    .select("id, username, total_profit, total_wins, total_losses, total_rounds")
    .order("username");

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
    money(allRounds.reduce((sum, r) => sum + Number(r.stake || 0), 0));

  const select = document.getElementById("roundUser");

  select.innerHTML = `
    <option value="">Spieler auswählen...</option>
    ${allPlayers.map(p => `
      <option value="${p.id}">${escapeHTML(p.username)}</option>
    `).join("")}
  `;

  document.getElementById("players").innerHTML =
    allPlayers.map(p => {
      const own = allRounds.filter(r => r.user_id === p.id);

      const wins = own.filter(r => r.won === true).length;
      const losses = own.filter(r => r.won === false).length;

      const profit = own.reduce(
        (sum, r) => sum + Number(r.result || 0), 0
      );

      const rate = own.length
        ? (wins / own.length * 100).toFixed(1)
        : "0.0";

      return `
        <div class="player">
          <b>${escapeHTML(p.username)}</b>
          <p>Runden: ${own.length}</p>
          <p>Siege: ${wins} | Niederlagen: ${losses}</p>
          <p>Winrate: ${rate}%</p>
          <p>Profit: ${money(profit)}</p>
          <p>Umsatz: ${money(
            own.reduce((sum, r) => sum + Number(r.stake || 0), 0)
          )}</p>
        </div>
      `;
    }).join("") || "Keine Spieler vorhanden.";

  document.getElementById("roundList").innerHTML =
    allRounds.slice(0, 50).map(r => `
      <div class="player">
        <b>${escapeHTML(r.game_name)}</b>
        <p>Spieler-ID: ${escapeHTML(r.user_id)}</p>
        <p>Einsatz: ${money(r.stake)}</p>
        <p>Profit: ${money(r.result)}</p>
        <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>

        <button onclick="editRound(${r.id})">
          BEARBEITEN
        </button>

        <button class="danger" onclick="deleteRound(${r.id})">
          LÖSCHEN
        </button>
      </div>
    `).join("") || "Noch keine Einträge.";
}

// ==========================================
// STATISTIK SPEICHERN
// ==========================================

async function saveRound() {
  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();
  const stake = Number(document.getElementById("stake").value);
  const resultText = document.getElementById("result").value;
  const result = Number(resultText);
  const won = document.getElementById("won").value === "true";

  if (
    !userId ||
    !gameName ||
    !Number.isSafeInteger(stake) ||
    stake < 0 ||
    resultText === "" ||
    !Number.isSafeInteger(result)
  ) {
    return showMessage("Bitte gültige Werte eingeben!");
  }

  let response;

  if (editingRoundId !== null) {
    response = await db
      .from("ks_rounds")
      .update({
        user_id: userId,
        game_name: gameName,
        stake,
        result,
        won
      })
      .eq("id", editingRoundId);
  } else {
    response = await db
      .from("ks_rounds")
      .insert({
        user_id: userId,
        game_name: gameName,
        stake,
        result,
        won
      });
  }

  if (response.error) {
    return showMessage(response.error.message);
  }

  resetRoundForm();

  showMessage("Statistik erfolgreich gespeichert!");

  await loadAdminData();
}

// ==========================================
// BEARBEITEN
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
// FORMULAR RESET
// ==========================================

function resetRoundForm() {
  editingRoundId = null;

  document.getElementById("roundUser").value = "";
  document.getElementById("gameName").value = "";
  document.getElementById("stake").value = "";
  document.getElementById("result").value = "";
  document.getElementById("won").value = "true";

  document.getElementById("saveRoundButton").textContent =
    "STATISTIK SPEICHERN";
}

// ==========================================
// LÖSCHEN
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
// LOGOUT
// ==========================================

async function adminLogout() {
  await db.auth.signOut();
  location.href = "index.html";
}
