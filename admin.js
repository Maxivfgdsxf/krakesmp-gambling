
/* ==========================================
   KRAKESMP - OWNER ADMIN PANEL
   ========================================== */

// ==========================================
// SUPABASE VERBINDUNG
// ==========================================

const SUPABASE_URL =
  "https://zrijikvllmotgsixcguc.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_UzsR-fZu";

if (!window.supabase) {
  throw new Error("Supabase konnte nicht geladen werden!");
}

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// ==========================================
// VARIABLEN
// ==========================================

let editingRoundId = null;
let adminVerified = false;
let adminLoading = false;

const OWNER_ID =
  "cee3680c-3580-47c5-8c64-0277eac03800";

// ==========================================
// HILFSFUNKTIONEN
// ==========================================

const money = n =>
  Number(n || 0).toLocaleString("de-DE") + " Coins";

function showMessage(message) {
  alert(message);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function setStatus(message) {
  const status = document.getElementById("status");

  if (status) {
    status.textContent = message;
  }
}

function showLogin(message = "") {
  adminVerified = false;

  document.getElementById("loginPanel").style.display = "block";
  document.getElementById("adminPanel").style.display = "none";

  const error = document.getElementById("loginError");

  if (error) {
    error.textContent = message;
  }
}

function showAdmin() {
  adminVerified = true;

  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  setStatus("OWNER AKTIV");
}

// ==========================================
// OWNER BERECHTIGUNG PRÜFEN
// ==========================================

async function verifyAdmin() {
  const {
    data: { user },
    error: userError
  } = await db.auth.getUser();

  if (userError || !user) {
    return false;
  }

  // Zusätzliche Prüfung der bekannten Owner-ID
  if (user.id !== OWNER_ID) {
    return false;
  }

  // Serverseitige Owner-Prüfung
  const { data, error } = await db.rpc("krake_is_admin");

  if (error) {
    console.error("OWNER PRÜFUNG FEHLER:", error);
    throw error;
  }

  return data === true;
}

// ==========================================
// LOGIN
// ==========================================

async function adminLogin() {
  if (adminLoading) return;

  adminLoading = true;

  const button = document.getElementById("loginButton");

  if (button) {
    button.disabled = true;
    button.textContent = "LOGIN WIRD GEPRÜFT...";
  }

  try {
    const email =
      document.getElementById("email").value.trim();

    const password =
      document.getElementById("password").value;

    if (!email || !password) {
      return showLogin("Bitte E-Mail und Passwort eingeben!");
    }

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return showLogin(error.message);
    }

    let allowed = false;

    try {
      allowed = await verifyAdmin();
    } catch (error) {
      console.error("ADMIN RPC FEHLER:", error);
      await db.auth.signOut();

      return showLogin(
        "Owner-Prüfung fehlgeschlagen. Bitte Datenbankfunktion krake_is_admin prüfen."
      );
    }

    if (!allowed) {
      await db.auth.signOut();

      return showLogin("Kein Owner-Zugriff!");
    }

    showAdmin();

    await loadAdminData();

    console.log("KRAKESMP OWNER PANEL AKTIV");

  } catch (error) {
    console.error("LOGIN FEHLER:", error);

    showLogin("Ein Fehler ist beim Login aufgetreten.");

  } finally {
    adminLoading = false;

    if (button) {
      button.disabled = false;
      button.textContent = "👑 EINLOGGEN";
    }
  }
}

// ==========================================
// BESTEHENDE ANMELDUNG PRÜFEN
// ==========================================

async function checkExistingLogin() {
  showLogin();

  try {
    const allowed = await verifyAdmin();

    if (!allowed) {
      return;
    }

    showAdmin();

    await loadAdminData();

  } catch (error) {
    console.error("SESSION PRÜFUNG FEHLER:", error);
    showLogin("Owner-Zugriff konnte nicht geprüft werden.");
  }
}

// ==========================================
// ADMIN DATEN LADEN
// ==========================================

async function loadAdminData() {
  if (!adminVerified) {
    return showMessage("Kein Owner-Zugriff!");
  }

  const playersContainer =
    document.getElementById("players");

  const roundContainer =
    document.getElementById("roundList");

  if (playersContainer) {
    playersContainer.textContent = "Spieler werden geladen...";
  }

  if (roundContainer) {
    roundContainer.textContent = "Statistiken werden geladen...";
  }

  try {
    const { data: players, error } = await db
      .from("ks_players")
      .select(
        "id, username, total_profit, total_wins, total_losses, total_rounds"
      )
      .order("username");

    if (error) throw error;

    const { data: rounds, error: roundError } = await db
      .from("ks_rounds")
      .select("*")
      .order("created_at", { ascending: false });

    if (roundError) throw roundError;

    const allPlayers = players || [];
    const allRounds = rounds || [];

    document.getElementById("playerCount").textContent =
      allPlayers.length;

    const totalTurnover = allRounds.reduce(
      (sum, r) => sum + Number(r.stake || 0),
      0
    );

    document.getElementById("totalTurnover").textContent =
      money(totalTurnover);

    // SPIELER AUSWÄHLEN

    const select = document.getElementById("roundUser");

    select.innerHTML = `
      <option value="">Spieler auswählen...</option>
      ${allPlayers.map(p => `
        <option value="${escapeHTML(p.id)}">
          ${escapeHTML(p.username)}
        </option>
      `).join("")}
    `;

    // SPIELERVERWALTUNG

    playersContainer.innerHTML =
      allPlayers.map(p => {
        const own = allRounds.filter(
          r => r.user_id === p.id
        );

        const wins =
          own.filter(r => r.won === true).length;

        const losses =
          own.filter(r => r.won === false).length;

        const profit = own.reduce(
          (sum, r) => sum + Number(r.result || 0),
          0
        );

        const turnover = own.reduce(
          (sum, r) => sum + Number(r.stake || 0),
          0
        );

        const rate = own.length
          ? (wins / own.length * 100).toFixed(1)
          : "0.0";

        return `
          <div class="player">

            <b>👤 ${escapeHTML(p.username)}</b>

            <p>Runden: ${own.length}</p>

            <p>Siege: ${wins} | Niederlagen: ${losses}</p>

            <p>Winrate: ${rate}%</p>

            <p>Profit: ${money(profit)}</p>

            <p>Umsatz: ${money(turnover)}</p>

          </div>
        `;
      }).join("") || "Keine Spieler vorhanden.";

    // STATISTIKVERLAUF

    roundContainer.innerHTML =
      allRounds.slice(0, 50).map(r => `
        <div class="player">

          <b>${escapeHTML(r.game_name)}</b>

          <p>Spieler-ID: ${escapeHTML(r.user_id)}</p>

          <p>Einsatz: ${money(r.stake)}</p>

          <p>Profit: ${money(r.result)}</p>

          <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>

          <p class="small">
            ${r.created_at
              ? new Date(r.created_at).toLocaleString("de-DE")
              : ""}
          </p>

          <button
            type="button"
            data-action="edit"
            data-id="${escapeHTML(r.id)}">
            BEARBEITEN
          </button>

          <button
            class="danger"
            type="button"
            data-action="delete"
            data-id="${escapeHTML(r.id)}">
            LÖSCHEN
          </button>

        </div>
      `).join("") || "Noch keine Einträge.";

    console.log("ADMIN DATEN GELADEN!");

  } catch (error) {
    console.error("ADMIN DATEN FEHLER:", error);

    showMessage(
      "Daten konnten nicht geladen werden: " + error.message
    );
  }
}

// ==========================================
// STATISTIK SPEICHERN
// ==========================================

async function saveRound() {
  if (!adminVerified) {
    return showMessage("Kein Owner-Zugriff!");
  }

  const userId =
    document.getElementById("roundUser").value;

  const gameName =
    document.getElementById("gameName").value.trim();

  const stakeText =
    document.getElementById("stake").value;

  const resultText =
    document.getElementById("result").value;

  const stake = Number(stakeText);
  const result = Number(resultText);

  const won =
    document.getElementById("won").value === "true";

  if (
    !userId ||
    !gameName ||
    gameName.length > 100 ||
    stakeText === "" ||
    resultText === "" ||
    !Number.isSafeInteger(stake) ||
    stake < 0 ||
    !Number.isSafeInteger(result)
  ) {
    return showMessage("Bitte gültige Werte eingeben!");
  }

  try {
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
      throw response.error;
    }

    resetRoundForm();

    showMessage("Statistik erfolgreich gespeichert!");

    await loadAdminData();

  } catch (error) {
    console.error("SPEICHERFEHLER:", error);
    showMessage("Speichern fehlgeschlagen: " + error.message);
  }
}

// ==========================================
// STATISTIK BEARBEITEN
// ==========================================

async function editRound(id) {
  if (!adminVerified) {
    return showMessage("Kein Owner-Zugriff!");
  }

  try {
    const { data, error } = await db
      .from("ks_rounds")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    editingRoundId = id;

    document.getElementById("roundUser").value =
      data.user_id;

    document.getElementById("gameName").value =
      data.game_name;

    document.getElementById("stake").value =
      data.stake;

    document.getElementById("result").value =
      data.result;

    document.getElementById("won").value =
      String(data.won);

    document.getElementById("saveRoundButton").textContent =
      "ÄNDERUNGEN SPEICHERN";

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } catch (error) {
    console.error("BEARBEITUNGSFEHLER:", error);
    showMessage(error.message);
  }
}

// ==========================================
// STATISTIK LÖSCHEN
// ==========================================

async function deleteRound(id) {
  if (!adminVerified) {
    return showMessage("Kein Owner-Zugriff!");
  }

  if (!confirm("Statistik wirklich löschen?")) {
    return;
  }

  try {
    const { error } = await db
      .from("ks_rounds")
      .delete()
      .eq("id", id);

    if (error) throw error;

    showMessage("Statistik gelöscht!");

    await loadAdminData();

  } catch (error) {
    console.error("LÖSCHFEHLER:", error);
    showMessage("Löschen fehlgeschlagen: " + error.message);
  }
}

// ==========================================
// STATISTIK BUTTONS
// ==========================================

document.getElementById("roundList")
  ?.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === "edit") {
      editRound(id);
    }

    if (button.dataset.action === "delete") {
      deleteRound(id);
    }
  });

// ==========================================
// FORMULAR ZURÜCKSETZEN
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
// LOGOUT
// ==========================================

async function adminLogout() {
  try {
    const { error } = await db.auth.signOut();

    if (error) throw error;

    adminVerified = false;

    location.href = "index.html";

  } catch (error) {
    console.error("LOGOUT FEHLER:", error);
    showMessage(error.message);
  }
}

// ==========================================
// START
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  console.log("KRAKESMP OWNER PANEL STARTET...");

  checkExistingLogin();
});
