
// ======================================
// KRAKESMP - PLAYER SYSTEM
// ======================================

const SUPABASE_URL = "https://zrijikvllmotgsixcguc.supabase.co";
const SUPABASE_KEY = "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_UzsR-fZu";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let currentProfile = null;
let currentStats = null;
let isAdmin = false;

const money = value =>
  Number(value || 0).toLocaleString("de-DE") + " Coins";

function showMessage(message) {
  const element = document.getElementById("message");

  if (element) {
    element.textContent = message;
  } else {
    alert(message);
  }
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

// ======================================
// VIP RANKS
// ======================================

function getRank(turnover) {
  turnover = Number(turnover || 0);

  if (turnover >= 100_000_000_000) {
    return {
      name: "ULTIMATE GAMBLER",
      bonus: "10%",
      className: "ultimate"
    };
  }

  if (turnover >= 10_000_000_000) {
    return {
      name: "GOLD",
      bonus: "7%",
      className: ""
    };
  }

  if (turnover >= 5_000_000_000) {
    return {
      name: "SILVER",
      bonus: "4%",
      className: ""
    };
  }

  if (turnover >= 1_000_000_000) {
    return {
      name: "BRONZE",
      bonus: "2,5%",
      className: ""
    };
  }

  return {
    name: "UNRANKED",
    bonus: "0%",
    className: ""
  };
}

// ======================================
// LOGIN
// ======================================

async function login() {
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    return showMessage("Bitte E-Mail und Passwort eingeben!");
  }

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return showMessage(error.message);
  }

  await loadAccount();
}

// ======================================
// LOGOUT
// ======================================

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    return showMessage(error.message);
  }

  currentUser = null;
  currentProfile = null;
  currentStats = null;
  isAdmin = false;

  updateInterface();
  showMessage("Du wurdest abgemeldet.");
}

// ======================================
// ACCOUNT LADEN
// ======================================

async function loadAccount() {
  const {
    data: { user },
    error: authError
  } = await db.auth.getUser();

  if (authError || !user) {
    currentUser = null;
    currentProfile = null;
    currentStats = null;
    isAdmin = false;
    updateInterface();
    return;
  }

  currentUser = user;

  const { data: profile, error: profileError } = await db
    .from("ks_profiles")
    .select("user_id, username, balance")
    .eq("user_id", user.id)
    .single();

  if (profileError) {
    showMessage("Profilfehler: " + profileError.message);
    return;
  }

  const { data: stats, error: statsError } = await db
    .from("ks_stats")
    .select("profit, turnover, wins, losses, rounds")
    .eq("user_id", user.id)
    .single();

  if (statsError) {
    showMessage("Statistikfehler: " + statsError.message);
    return;
  }

  currentProfile = profile;
  currentStats = stats;

  const { data: ownerResult, error: ownerError } =
    await db.rpc("ks_is_owner");

  isAdmin = !ownerError && ownerResult === true;

  updateInterface();

  await loadMyRounds();
}

// ======================================
// INTERFACE AKTUALISIEREN
// ======================================

function updateInterface() {
  const loginPanel = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboard");

  if (loginPanel) {
    loginPanel.classList.toggle("hidden", !!currentUser);
  }

  if (dashboard) {
    dashboard.classList.toggle("hidden", !currentUser);
  }

  if (!currentUser || !currentProfile || !currentStats) {
    return;
  }

  const wins = Number(currentStats.wins || 0);
  const losses = Number(currentStats.losses || 0);
  const total = wins + losses;

  const winrate = total > 0
    ? (wins / total * 100).toFixed(1)
    : "0.0";

  const rank = getRank(currentStats.turnover);

  document.getElementById("profileName").textContent =
    currentProfile.username;

  document.getElementById("myProfit").textContent =
    money(currentStats.profit);

  document.getElementById("myWinrate").textContent =
    winrate + "%";

  document.getElementById("myRounds").textContent =
    Number(currentStats.rounds
