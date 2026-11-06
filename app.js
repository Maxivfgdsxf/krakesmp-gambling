
"use strict";

// ==========================================
// KRAKESMP PLAYER SYSTEM V2
// ==========================================

const SUPABASE_URL =
  "https://zrijikvllmotgsixcguc.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_UzsR-fZu";

const OWNER_ID =
  "cee3680c-3580-47c5-8c64-0277eac03800";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

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

function message(text, success = false) {
  const element = $("authMessage");
  if (!element) return;

  element.textContent = text;
  element.className = success ? "green" : "red";
}

function usernameEmail(username) {
  return username.toLowerCase() + "@accounts.krakesmp.invalid";
}

async function api(action, values = {}) {
  const { data, error } = await db.functions.invoke("owner-api", {
    body: { action, ...values }
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

// ==========================================
// TABS
// ==========================================

$("showLogin").addEventListener("click", () => {
  $("loginForm").hidden = false;
  $("registerForm").hidden = true;
  message("");
});

$("showRegister").addEventListener("click", () => {
  $("loginForm").hidden = true;
  $("registerForm").hidden = false;
  message("");
});

// ==========================================
// ACCOUNT BEANTRAGEN
// ==========================================

$("registerButton").addEventListener("click", async () => {
  const button = $("registerButton");
  const username = $("registerUsername").value.trim();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return message(
      "Benutzername: 3-20 Zeichen, nur Buchstaben, Zahlen und _."
    );
  }

  button.disabled = true;

  try {
    await api("apply", { username });

    message(
      "Dein Antrag wurde eingereicht! Warte auf die Freischaltung durch den Owner.",
      true
    );

    $("registerUsername").value = "";

  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
});

// ==========================================
// LOGIN MIT BENUTZERNAME UND SICHERHEITSCODE
// ==========================================

$("loginButton").addEventListener("click", login);

async function login() {
  const button = $("loginButton");

  const username = $("loginUsername").value.trim();
  const code = $("loginCode").value;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username) ||
      code.length < 12) {
    return message("Benutzername oder Sicherheitscode ungültig.");
  }

  button.disabled = true;

  try {
    const { error } = await db.auth.signInWithPassword({
      email: usernameEmail(username),
      password: code
    });

    if (error) throw error;

    const allowed = await checkPlayer();

    if (!allowed) {
      await db.auth.signOut();
      return;
    }

    $("loginCode").value = "";
    await loadDashboard();

    message("Erfolgreich eingeloggt!", true);

  } catch (error) {
    console.error(error);
    message("Login fehlgeschlagen. Prüfe Benutzername und Sicherheitscode.");
  } finally {
    button.disabled = false;
  }
}

// ==========================================
// SPIELER STATUS PRÜFEN
// ==========================================

async function checkPlayer() {
  const {
    data: { user },
    error: authError
  } = await db.auth.getUser();

  if (authError || !user) return false;

  const { data, error } = await db
    .from("ks_players")
    .select("id, username, status, is_banned")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    message("Spielerprofil nicht verfügbar.");
    return false;
  }

  if (data.is_banned || data.status !== "active") {
    message("Dein Account ist gesperrt. Bitte Owner kontaktieren.");
    return false;
  }

  return true;
}

// ==========================================
// DASHBOARD
// ==========================================

async function loadDashboard() {
  const {
    data: { user }
  } = await db.auth.getUser();

  if (!user) return;

  const { data: profile, error } = await db
    .from("ks_players")
    .select("id, username, status, is_banned")
    .eq("id", user.id)
    .single();

  if (error) throw error;

  if (profile.is_banned || profile.status !== "active") {
    await db.auth.signOut();
    return;
  }

  $("loginPanel").hidden = true;
  $("dashboard").hidden = false;

  $("profileName").textContent = profile.username;

  $("ownerButton").hidden = user.id !== OWNER_ID;

  const { data: rounds, error: roundsError } = await db
    .from("ks_rounds")
    .select("game_name, stake, result, won, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (roundsError) throw roundsError;

  const list = rounds || [];

  const profit = list.reduce(
    (sum, r) => sum + Number(r.result || 0),
    0
  );

  const wins = list.filter(r => r.won === true).length;

  const rate = list.length
    ? (wins / list.length * 100).toFixed(1)
    : "0.0";

  $("myRounds").textContent = list.length;
  $("myProfit").textContent = money(profit);
  $("myWinrate").textContent = rate + "%";

  $("myRoundsList").innerHTML = list.slice(0, 20).map(r => `
    <div class="player">
      <b>${escapeHTML(r.game_name)}</b>
      <p>Einsatz: ${money(r.stake)}</p>
      <p>Ergebnis: ${money(r.result)}</p>
      <p class="${r.won ? "green" : "red"}">
        ${r.won ? "GEWONNEN" : "VERLOREN"}
      </p>
      <span class="small">
        ${r.created_at
          ? new Date(r.created_at).toLocaleString("de-DE")
          : ""}
      </span>
    </div>
  `).join("") || "Noch keine Spielrunden.";
}

// ==========================================
// LOGOUT
// ==========================================

$("logoutButton").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

// ==========================================
// LEADERBOARD
// ==========================================

async function loadLeaderboard() {
  const container = $("ranking");

  try {
    const { data, error } = await db.rpc("krake_leaderboard");

    if (error) throw error;

    container.innerHTML = (data || []).map((p, i) => `
      <div class="player">
        <div class="row">
          <b>
            ${["🥇", "🥈", "🥉"][i] || "🏅"}
            ${escapeHTML(p.username)}
          </b>
          <b>${i + 1}. Platz</b>
        </div>

        <p>Profit:
          <strong>${money(p.total_profit)}</strong>
        </p>

        <p>Winrate:
          <strong>${Number(p.winrate).toFixed(1)}%</strong>
        </p>
      </div>
    `).join("") || "Noch keine Spieler vorhanden.";

  } catch (error) {
    console.error("LEADERBOARD:", error);
    container.textContent =
      "Rangliste konnte nicht geladen werden: " + error.message;
  }
}

// ==========================================
// START
// ==========================================

async function start() {
  await loadLeaderboard();

  const {
    data: { session }
  } = await db.auth.getSession();

  if (!session) return;

  const allowed = await checkPlayer();

  if (!allowed) {
    await db.auth.signOut();
    return;
  }

  try {
    await loadDashboard();
  } catch (error) {
    console.error("DASHBOARD:", error);
    message("Dashboard konnte nicht geladen werden.");
  }
}

start();
