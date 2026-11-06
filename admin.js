
// ==========================================
// KRAKESMP OWNER PANEL
// ==========================================

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
// SPIELER LADEN
// ==========================================

async function loadAdminData() {
  const { data: players, error } = await db
    .from("krake_profiles")
    .select("user_id, username, total_turnover")
    .order("username");

  if (error) return showMessage(error.message);

  document.getElementById("playerCount").textContent =
    players.length;

  const select = document.getElementById("roundUser");

  select.innerHTML = players.map(p => `
    <option value="${p.user_id}">
      ${escapeHTML(p.username)}
    </option>
  `).join("");

  document.getElementById("players").innerHTML =
    players.map(p => `
      <div class="player">
        <b>${escapeHTML(p.username)}</b>
        <p>Umsatz: ${money(p.total_turnover)}</p>
        <button onclick="editPlayer('${p.user_id}')">
          STATISTIKEN ANSEHEN
        </button>
      </div>
    `).join("") || "Keine Spieler.";

  await loadAdminRounds();
}

// ==========================================
// GESAMTUMSATZ
// ==========================================

async function loadAdminRounds() {
  const { data, error } = await db
    .from("ks_rounds")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return showMessage(error.message);

  const rounds = data || [];

  document.getElementById("totalTurnover").textContent =
    money(rounds.reduce((sum, r) => sum + Number(r.stake), 0));

  document.getElementById("roundList").innerHTML =
    rounds.slice(0, 30).map(r => `
      <div class="player">
        <b>${escapeHTML(r.game_name)}</b>
        <p>Spieler-ID: ${escapeHTML(r.user_id)}</p>
        <p>Einsatz: ${money(r.stake)}</p>
        <p>Profit: ${money(r.result)}</p>
        <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>
        <button onclick="deleteRound(${r.id})">
          EINTRAG LÖSCHEN
        </button>
      </div>
    `).join("") || "Keine Einträge.";
}

// ==========================================
// STATISTIK EINTRAGEN
// ==========================================

async function addRound() {
  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();
  const stake = Number(document.getElementById("stake").value);
  const result = Number(document.getElementById("result").value);
  const won = document.getElementById("won").value === "true";

  if (!userId || !gameName ||
      !Number.isSafeInteger(stake) || stake < 0 ||
      !Number.isSafeInteger(result)) {
    return showMessage("Bitte gültige Daten eingeben!");
  }

  const { error } = await db
    .from("ks_rounds")
    .insert({
      user_id: userId,
      game_name: gameName,
      stake,
      result,
      won
    });

  if (error) return showMessage(error.message);

  document.getElementById("gameName").value = "";
  document.getElementById("stake").value = "";
  document.getElementById("result").value = "";

  showMessage("Statistik gespeichert!");

  await loadAdminData();
}

// ==========================================
// SPIELERSTATISTIK
// ==========================================

async function editPlayer(userId) {
  const { data, error } = await db
    .from("ks_rounds")
    .select("*")
    .eq("user_id", userId);

  if (error) return showMessage(error.message);

  const rounds = data || [];
  const wins = rounds.filter(r => r.won).length;
  const losses = rounds.filter(r => !r.won).length;
  const profit = rounds.reduce((s, r) => s + Number(r.result), 0);

  showMessage(
    "Spielerstatistik\n" +
    "Runden: " + rounds.length +
    "\nSiege: " + wins +
    "\nNiederlagen: " + losses +
    "\nWinrate: " +
    (rounds.length ? (wins / rounds.length * 100).toFixed(1) : 0) +
    "%\nProfit: " + money(profit)
  );
}

// ==========================================
// EINTRAG LÖSCHEN
// ==========================================

async function deleteRound(id) {
  if (!confirm("Statistik wirklich löschen?")) return;

  const { error } = await db
    .from("ks_rounds")
    .delete()
    .eq("id", id);

  if (error) return showMessage(error.message);

  showMessage("Eintrag gelöscht!");
  await loadAdminData();
}

// ==========================================
// ABMELDEN
// ==========================================

async function adminLogout() {
  await db.auth.signOut();
  location.href = "index.html";
}
