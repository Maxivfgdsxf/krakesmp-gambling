
// ==========================================
// KRAKESMP - OWNER ADMIN SYSTEM
// ==========================================

const ADMIN_DB = db;

// Owner-Zugriff prüfen
async function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    return showMessage("Bitte Zugangsdaten eingeben!");
  }

  const { error } = await ADMIN_DB.auth.signInWithPassword({
    email,
    password
  });

  if (error) return showMessage(error.message);

  const { data: allowed, error: adminError } =
    await ADMIN_DB.rpc("krake_is_admin");

  if (adminError || allowed !== true) {
    await ADMIN_DB.auth.signOut();
    return showMessage("Kein Owner-Zugriff!");
  }

  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  await loadAdminData();
}

// Admin-Daten laden
async function loadAdminData() {
  const { data: players, error } = await ADMIN_DB
    .from("krake_profiles")
    .select("*")
    .order("total_turnover", { ascending: false });

  if (error) return showMessage(error.message);

  const playerSelect = document.getElementById("roundUser");

  document.getElementById("playerCount").textContent =
    players.length;

  document.getElementById("totalTurnover").textContent =
    money(players.reduce(
      (sum, p) => sum + Number(p.total_turnover || 0), 0
    ));

  playerSelect.innerHTML = players.map(p => `
    <option value="${p.user_id}">
      ${escapeHTML(p.username)}
    </option>
  `).join("");

  document.getElementById("players").innerHTML =
    players.map(p => `
      <div class="player">
        <b>${escapeHTML(p.username)}</b>
        <p>Umsatz: ${money(p.total_turnover)}</p>
      </div>
    `).join("") || "Keine Spieler vorhanden.";

  await loadAdminRounds();
}

// Neue Statistik eintragen
async function addRound() {
  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();
  const stake = Number(document.getElementById("stake").value);
  const result = Number(document.getElementById("result").value);
  const won = document.getElementById("won").value === "true";

  if (!userId || !gameName) {
    return showMessage("Bitte Spieler und Spielnamen auswählen!");
  }

  if (!Number.isSafeInteger(stake) || stake < 0 ||
      !Number.isSafeInteger(result)) {
    return showMessage("Ungültige Zahlen!");
  }

  const { error } = await ADMIN_DB
    .from("ks_rounds")
    .insert({
      user_id: userId,
      game_name: gameName,
      stake,
      result,
      won
    });

  if (error) return showMessage(error.message);

  const { error: updateError } = await ADMIN_DB
    .from("krake_profiles")
    .update({
      total_turnover: undefined
    })
    .eq("user_id", userId);

  // Umsatz wird separat über die Datenbank verwaltet.
  await loadAdminData();

  document.getElementById("gameName").value = "";
  document.getElementById("stake").value = "";
  document.getElementById("result").value = "";

  showMessage("Statistik gespeichert!");
}

// Letzte Einträge anzeigen
async function loadAdminRounds() {
  const { data, error } = await ADMIN_DB
    .from("ks_rounds")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    document.getElementById("roundList").textContent =
      error.message;
    return;
  }

  document.getElementById("roundList").innerHTML =
    (data || []).map(r => `
      <div class="player">
        <b>${escapeHTML(r.game_name)}</b>
        <p>Spieler-ID: ${escapeHTML(r.user_id)}</p>
        <p>Einsatz: ${money(r.stake)}</p>
        <p>Ergebnis: ${money(r.result)}</p>
        <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>
      </div>
    `).join("") || "Noch keine Einträge.";
}

// Abmelden
async function adminLogout() {
  await ADMIN_DB.auth.signOut();
  location.reload();
}
