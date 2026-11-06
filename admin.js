
"use strict";

// ==========================================
// KRAKESMP OWNER PANEL V3
// ==========================================

const SUPABASE_URL =
  "https://zrijikvllmotgsixcguc.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_Uzs";

const OWNER_ID =
  "cee3680c-3580-47c5-8c64-0277eac03800";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let players = [];
let rounds = [];
let applications = [];
let verified = false;

const money = n =>
  Number(n || 0).toLocaleString("de-DE") + " Coins";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function randomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    b => chars[b % chars.length]
  ).join("");
}

// ==========================================
// PANELS
// ==========================================

function showLogin() {
  $("loginPanel").hidden = false;
  $("adminPanel").style.display = "none";
}

function showAdmin() {
  $("loginPanel").hidden = true;
  $("adminPanel").style.display = "block";
}

// ==========================================
// API MIT AUTHORIZATION HEADER
// ==========================================

async function api(action, values = {}) {
  const {
    data: { session },
    error: sessionError
  } = await db.auth.getSession();

  if (sessionError) throw sessionError;

  if (!session?.access_token) {
    throw new Error("Nicht angemeldet. Bitte erneut einloggen.");
  }

  const { data, error } = await db.functions.invoke(
    "owner-api",
    {
      body: {
        action,
        ...values
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

// ==========================================
// OWNER PRÜFEN
// ==========================================

async function verifyOwner() {
  const {
    data: { user },
    error
  } = await db.auth.getUser();

  if (error || !user || user.id !== OWNER_ID) {
    throw new Error("Kein Owner-Zugriff!");
  }

  verified = true;
}

// ==========================================
// LOGIN
// ==========================================

async function adminLogin() {
  const button = $("loginButton");

  button.disabled = true;
  $("loginError").textContent = "";

  try {
    const email = $("email").value.trim();
    const password = $("password").value;

    if (!email || !password) {
      throw new Error("Bitte E-Mail und Passwort eingeben.");
    }

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await verifyOwner();

    $("password").value = "";

    showAdmin();

    await loadAdminData();

  } catch (error) {
    console.error("OWNER LOGIN:", error);

    $("loginError").textContent = error.message;

    verified = false;

    await db.auth.signOut();

    showLogin();

  } finally {
    button.disabled = false;
  }
}

// ==========================================
// DATEN LADEN
// ==========================================

async function loadAdminData() {
  if (!verified) {
    throw new Error("Owner nicht angemeldet.");
  }

  try {
    const data = await api("list");

    applications = data.applications || [];
    players = data.players || [];
    rounds = data.rounds || [];

    $("playerCount").textContent = players.length;

    $("totalTurnover").textContent = money(
      rounds.reduce(
        (sum, r) => sum + Number(r.stake || 0),
        0
      )
    );

    renderApplications();
    renderPlayers();
    renderRounds();
    renderPlayerSelect();

  } catch (error) {
    console.error("LOAD ADMIN DATA:", error);

    alert("Ladefehler: " + error.message);
  }
}

// ==========================================
// ACCOUNT-ANTRÄGE
// ==========================================

function renderApplications() {
  const container = $("applications");

  // Bereich ist in der bisherigen HTML noch nicht vorhanden.
  if (!container) return;

  container.innerHTML = applications.map(a => `
    <div class="player">
      <b>${escapeHTML(a.username)}</b>

      <p>Status: OFFEN</p>

      <p class="small">
        ${new Date(a.created_at).toLocaleString("de-DE")}
      </p>

      <button data-action="approve"
        data-id="${escapeHTML(a.id)}">
        FREISCHALTEN + CODE
      </button>

      <button class="danger"
        data-action="reject"
        data-id="${escapeHTML(a.id)}">
        ABLEHNEN
      </button>
    </div>
  `).join("") || "Keine offenen Anträge.";
}

const applicationsContainer = $("applications");

if (applicationsContainer) {
  applicationsContainer.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    try {
      if (action === "approve") {
        const application = applications.find(a => a.id == id);

        if (!application) return;

        if (!confirm(
          "Account für " + application.username +
          " freischalten?"
        )) return;

        const code = randomCode();

        await api("approve", { id, code });

        alert(
          "ACCOUNT ERSTELLT!\n\n" +
          "Benutzername: " + application.username +
          "\n\nSICHERHEITSCODE:\n" + code +
          "\n\nBitte privat weitergeben!"
        );
      }

      if (action === "reject") {
        if (!confirm("Antrag wirklich ablehnen?")) return;

        await api("reject", { id });
      }

      await loadAdminData();

    } catch (error) {
      alert("Fehler: " + error.message);
    }
  });
}

// ==========================================
// SPIELERVERWALTUNG
// ==========================================

function renderPlayers() {
  $("players").innerHTML = players.map(p => `
    <div class="player">

      <b>👤 ${escapeHTML(p.username)}</b>

      <p>Profit: ${money(p.total_profit)}</p>

      <p>Runden: ${Number(p.total_rounds || 0)}</p>

      <p class="${p.is_banned ? "red" : "green"}">
        ${p.is_banned ? "GEBANNT" : "AKTIV"}
      </p>

      <button data-action="code"
        data-id="${escapeHTML(p.id)}">
        NEUEN SICHERHEITSCODE
      </button>

      <button data-action="rename"
        data-id="${escapeHTML(p.id)}">
        NAME ÄNDERN
      </button>

      ${
        p.is_banned
          ? `<button data-action="unban"
              data-id="${escapeHTML(p.id)}">
              ENTBANNEN
            </button>`
          : `<button class="danger"
              data-action="ban"
              data-id="${escapeHTML(p.id)}">
              BANNEN
            </button>`
      }

      <button class="danger"
        data-action="delete"
        data-id="${escapeHTML(p.id)}">
        ACCOUNT LÖSCHEN
      </button>

    </div>
  `).join("") || "Keine Spieler vorhanden.";
}

$("players").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  const player = players.find(p => p.id === id);

  if (!player) return;

  try {
    if (action === "code") {
      if (!confirm(
        "Neuen Sicherheitscode für " +
        player.username + " erstellen?"
      )) return;

      const code = randomCode();

      await api("set_code", {
        id,
        code
      });

      alert(
        "NEUER SICHERHEITSCODE\n\n" +
        "Spieler: " + player.username +
        "\n\nCode:\n" + code +
        "\n\nBitte privat weitergeben!"
      );
    }

    if (action === "rename") {
      const username = prompt(
        "Neuer Benutzername:",
        player.username
      );

      if (!username) return;

      await api("rename", {
        id,
        username
      });
    }

    if (action === "ban") {
      const reason = prompt(
        "Banngrund:",
        "Regelverstoß"
      );

      if (reason === null) return;

      await api("ban", {
        id,
        reason
      });
    }

    if (action === "unban") {
      if (!confirm(
        player.username + " entbannen?"
      )) return;

      await api("unban", { id });
    }

    if (action === "delete") {
      if (!confirm(
        "ACHTUNG!\n\nAccount " +
        player.username +
        " und alle Spielrunden löschen?"
      )) return;

      await api("delete", { id });
    }

    await loadAdminData();

  } catch (error) {
    alert("Fehler: " + error.message);
  }
});

// ==========================================
// SPIELER AUSWÄHLEN
// ==========================================

function renderPlayerSelect() {
  $("roundUser").innerHTML = `
    <option value="">Spieler auswählen...</option>

    ${players
      .filter(p =>
        !p.is_banned &&
        p.status === "active"
      )
      .map(p => `
        <option value="${escapeHTML(p.id)}">
          ${escapeHTML(p.username)}
        </option>
      `).join("")}
  `;
}

// ==========================================
// RUNDE SPEICHERN
// ==========================================

async function saveRound() {
  const user_id = $("roundUser").value;
  const game_name = $("gameName").value.trim();

  const stakeText = $("stake").value;
  const resultText = $("result").value;

  const stake = Number(stakeText);
  const result = Number(resultText);

  const won = $("won").value === "true";

  if (
    !user_id ||
    !game_name ||
    !Number.isSafeInteger(stake) ||
    stake < 0 ||
    resultText === "" ||
    !Number.isSafeInteger(result)
  ) {
    alert("Bitte gültige Daten eingeben.");
    return;
  }

  try {
    await api("save_round", {
      user_id,
      game_name,
      stake,
      result,
      won
    });

    $("gameName").value = "";
    $("stake").value = "";
    $("result").value = "";

    alert("Spielrunde gespeichert!");

    await loadAdminData();

  } catch (error) {
    alert("Fehler: " + error.message);
  }
}

// ==========================================
// SPIELVERLAUF
// ==========================================

function renderRounds() {
  $("roundList").innerHTML = rounds
    .slice(0, 50)
    .map(r => `
      <div class="player">

        <b>${escapeHTML(r.game_name)}</b>

        <p>Spieler-ID: ${escapeHTML(r.user_id)}</p>

        <p>Einsatz: ${money(r.stake)}</p>

        <p>Ergebnis: ${money(r.result)}</p>

        <p>${r.won ? "GEWONNEN" : "VERLOREN"}</p>

        <button class="danger"
          data-delete-round="${escapeHTML(r.id)}">
          RUNDE LÖSCHEN
        </button>

      </div>
    `).join("") || "Keine Runden.";
}

$("roundList").addEventListener("click", async event => {
  const button = event.target.closest("[data-delete-round]");

  if (!button) return;

  const id = button.dataset.deleteRound;

  if (!confirm("Diese Runde wirklich löschen?")) return;

  try {
    await api("delete_round", { id });

    await loadAdminData();

  } catch (error) {
    alert("Fehler: " + error.message);
  }
});

// ==========================================
// LOGOUT
// ==========================================

async function adminLogout() {
  verified = false;

  await db.auth.signOut();

  location.href = "index.html";
}

// ==========================================
// START / SESSION WIEDERHERSTELLEN
// ==========================================

async function start() {
  showLogin();

  try {
    const {
      data: { session },
      error
    } = await db.auth.getSession();

    if (error) throw error;

    if (!session) return;

    await verifyOwner();

    showAdmin();

    await loadAdminData();

  } catch (error) {
    console.error("OWNER SESSION:", error);

    verified = false;

    await db.auth.signOut();

    showLogin();
  }
}

// ==========================================
// HTML BUTTONS VERFÜGBAR MACHEN
// ==========================================

window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.loadAdminData = loadAdminData;
window.saveRound = saveRound;

start();
