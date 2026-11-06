
// ==========================================
// KRAKESMP - OWNER ADMIN SYSTEM
// ==========================================

async function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    return showMessage("Bitte Login-Daten eingeben!");
  }

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) return showMessage(error.message);

  const { data: allowed, error: adminError } =
    await db.rpc("krake_is_admin");

  if (adminError || allowed !== true) {
    await db.auth.signOut();
    return showMessage("Kein Owner-Zugriff!");
  }

  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  await loadAdminData();
}

// ==========================================
// OWNER STATUS PRÜFEN
// ==========================================

async function verifyOwner() {
  const { data: { user } } = await db.auth.getUser();

  if (!user) return;

  const { data, error } = await db.rpc("krake_is_admin");

  if (!error && data === true) {
    document.getElementById("loginPanel").style.display = "none";
    document.getElementById("adminPanel").style.display = "block";
    await loadAdminData();
  }
}

// ==========================================
// SPIELER LADEN
// ==========================================

async function loadAdminData() {
  const { data: players, error } = await db
    .from("krake_profiles")
    .select("user_id, username, total_turnover, balance")
    .order("total_turnover", { ascending: false });

  if (error) return showMessage(error.message);

  const list = players || [];

  document.getElementById("playerCount").textContent = list.length;

  document.getElementById("totalTurnover").textContent =
    money(list.reduce(
      (sum, p) => sum + Number(p.total_turnover || 0), 0
    ));

  document.getElementById("players").innerHTML =
    list.map(p => `
      <div class="player">
        <b>${escapeHTML(p.username)}</b>
        <p>Umsatz: ${money(p.total_turnover)}</p>
        <p>Guthaben: ${money(p.balance)}</p>
        <button onclick="showPlayerRounds('${p.user_id}')">
          STATISTIKEN ANSEHEN
        </button>
      </div>
    `).join("") || "Keine Spieler vorhanden.";

  document.getElementById("roundUser").innerHTML =
    list.map(p => `
      <option value="${p.user_id}">
        ${escapeHTML(p.username)}
      </option>
    `).join("");

  await loadAllRounds();
}

// ==========================================
// STATISTIK EINTRAGEN
// ==========================================

async function addRound() {
  const userId = document.getElementById("roundUser").value;
  const gameName = document.getElementById("gameName").value.trim();

  const stakeText = document.getElementById("stake").value;
  const resultText = document.getElementById("result").value;

  const stake = Number(stakeText);
  const result = Number(resultText);
  const won = document.getElementById("won").value === "true";

  if (!userId || !gameName || stakeText === "" || resultText === "") {
    return showMessage("Bitte alle Felder ausfüllen!");
  }

  if (
    !Number.isSafeInteger(stake) ||
    stake < 0 ||
    !Number.isSafeInteger(result)
  ) {
    return showMessage("Ungültige Zahlen!");
  }

  if (!confirm("Statistik wirklich eintragen?")) return;

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

  showMessage("Statistik gespeichert!");

  document.getElementById("gameName").value = "";
  document.getElementById("stake").value = "";
  document.getElementById("result").value = "";

  await loadAdminData();
}

// ==========================================
// ALLE STATISTIKEN LADEN
// ==========================================

async function loadAllRounds() {
  const { data, error } = await db
    .from("ks_rounds")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return showMessage(error.message);

  document.getElementById("roundList").innerHTML =
    (data || []).map(round => `
      <div class="player">
        <b>${escapeHTML(round.game_name)}</b>
        <p>Spieler-ID: ${escapeHTML(round.user_id)}</p>
        <p>Einsatz: ${money(round.stake)}</p>
        <p>Ergebnis: ${money(round.result)}</p>
        <p>${round.won ? "GEWONNEN" : "VERLOREN"}</p>
        <button class="danger"
          onclick="deleteRound(${round.id})">
          EINTRAG LÖSCHEN
        </button>
      </div>
    `).join("") || "Noch keine Einträge.";
}

// ==========================================
// SPIELERSTATISTIKEN ANSEHEN
// ==========================================

async function showPlayerRounds(userId) {
  const { data, error } = await db
    .from("ks_rounds")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return showMessage(error.message);

  const rounds = data || [];

  const wins = rounds.filter(r => r.won).length;
  const losses = rounds.filter(r => !r.won).length;

  const profit = rounds.reduce(
    (sum, r) => sum + Number(r.result), 0
  );

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
// OWNER LOGOUT
// ==========================================

async function adminLogout() {
  await db.auth.signOut();
  location.href = "index.html";
}

// ==========================================
// AUTOMATISCHEN LOGIN PRÜFEN
// ==========================================

verifyOwner();
