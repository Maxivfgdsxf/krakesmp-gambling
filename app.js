
// ==========================================
// KRAKESMP - ACCOUNT & STATISTICS SYSTEM
// ==========================================

const SUPABASE_URL = "https://zrijikvllmotgsixcguc.supabase.co";
const SUPABASE_KEY = "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_Uzs";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let currentProfile = null;
let isAdmin = false;

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

function showMessage(message) {
  alert(message);
}

// ==========================================
// REGISTRIERUNG
// ==========================================

async function register() {
  const username =
    document.getElementById("username")?.value.trim();

  const email =
    document.getElementById("email")?.value.trim();

  const password =
    document.getElementById("password")?.value;

  if (!username || !email || !password) {
    return showMessage("Bitte alle Felder ausfüllen!");
  }

  if (username.length < 3 || username.length > 20) {
    return showMessage("Benutzername muss 3-20 Zeichen haben!");
  }

  if (password.length < 8) {
    return showMessage("Passwort muss mindestens 8 Zeichen haben!");
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) return showMessage(error.message);

  if (!data.session) {
    return showMessage(
      "Account erstellt! Bitte E-Mail bestätigen."
    );
  }

  showMessage("Account erfolgreich erstellt!");
  await loadAccount();
}

// ==========================================
// LOGIN
// ==========================================

async function login() {
  const email =
    document.getElementById("email")?.value.trim();

  const password =
    document.getElementById("password")?.value;

  if (!email || !password) {
    return showMessage("Bitte E-Mail und Passwort eingeben!");
  }

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) return showMessage(error.message);

  await loadAccount();
}

// ==========================================
// LOGOUT
// ==========================================

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) return showMessage(error.message);

  currentUser = null;
  currentProfile = null;
  isAdmin = false;

  updateInterface();
  location.reload();
}

// ==========================================
// ACCOUNT LADEN
// ==========================================

async function loadAccount() {
  const {
    data: { user },
    error: authError
  } = await db.auth.getUser();

  if (authError || !user) {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;
    updateInterface();
    return;
  }

  currentUser = user;

  const { data: profile, error } = await db
    .from("krake_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) {
    showMessage("Profilfehler: " + error.message);
    return;
  }

  currentProfile = profile;

  const { data: adminResult, error: adminError } =
    await db.rpc("krake_is_admin");

  isAdmin = !adminError && adminResult === true;

  updateInterface();

  await loadMyStatistics();
  await loadMyRounds();
}

// ==========================================
// INTERFACE
// ==========================================

function updateInterface() {
  const loginPanel = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboard");

  if (loginPanel) {
    loginPanel.style.display =
      currentUser ? "none" : "block";
  }

  if (dashboard) {
    dashboard.style.display =
      currentUser ? "block" : "none";
  }

  if (!currentProfile) return;

  const name = document.getElementById("profileName");
  const balance = document.getElementById("balance");

  if (name) {
    name.textContent = currentProfile.username;
  }

  if (balance) {
    balance.textContent = money(currentProfile.balance);
  }

  const adminButton = document.getElementById("adminLink");

  if (adminButton) {
    adminButton.style.display = isAdmin ? "block" : "none";
  }
}

// ==========================================
// EIGENE STATISTIKEN
// ==========================================

async function loadMyStatistics() {
  if (!currentUser) return;

  const { data, error } = await db
    .from("ks_rounds")
    .select("stake, result, won")
    .eq("user_id", currentUser.id);

  if (error) {
    console.error("Statistikfehler:", error.message);
    return;
  }

  const rounds = data || [];

  const totalRounds = rounds.length;

  const wins = rounds.filter(r => r.won === true).length;

  const losses = rounds.filter(r => r.won === false).length;

  const winrate = totalRounds > 0
    ? (wins / totalRounds * 100)
    : 0;

  const totalStake = rounds.reduce(
    (sum, r) => sum + Number(r.stake || 0),
    0
  );

  const totalProfit = rounds.reduce(
    (sum, r) => sum + Number(r.result || 0),
    0
  );

  const totalLoss = rounds.reduce(
    (sum, r) => sum + Math.max(0, -Number(r.result || 0)),
    0
  );

  const values = {
    myRounds: totalRounds,
    myWins: wins,
    myLosses: losses,
    myWinrate: winrate.toFixed(1) + "%",
    myTotalStake: money(totalStake),
    myProfit: money(totalProfit),
    myLoss: money(totalLoss)
  };

  for (const [id, value] of Object.entries(values)) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
}

// ==========================================
// EIGENE SPIELHISTORIE
// ==========================================

async function loadMyRounds() {
  if (!currentUser) return;

  const container =
    document.getElementById("myRoundsList");

  if (!container) return;

  const { data, error } = await db
    .from("ks_rounds")
    .select("game_name, stake, result, won, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    container.textContent =
      "Spielhistorie konnte nicht geladen werden.";
    console.error(error.message);
    return;
  }

  const rounds = data || [];

  container.innerHTML = rounds.slice(0, 10).map(round => `
    <div class="player">
      <b>${escapeHTML(round.game_name)}</b>
      <p>Einsatz: ${money(round.stake)}</p>
      <p>Ergebnis: ${money(round.result)}</p>
      <p class="${Number(round.result) >= 0 ? "green" : "red"}">
        ${round.won ? "GEWONNEN" : "VERLOREN"}
      </p>
      <span class="small">
        ${new Date(round.created_at).toLocaleString("de-DE")}
      </span>
    </div>
  `).join("") || "Noch keine Spielrunden.";
}

// ==========================================
// RANGLISTE
// ==========================================

async function loadLeaderboard() {
  const container =
    document.getElementById("ranking");

  if (!container) return;

  const { data, error } = await db
    .from("krake_profiles")
    .select("username, total_turnover")
    .order("total_turnover", { ascending: false });

  if (error) {
    container.textContent = "Rangliste konnte nicht geladen werden.";
    return;
  }

  container.innerHTML = (data || []).map((player, index) => `
    <div class="player">
      <div class="row">
        <b>${["🥇", "🥈", "🥉"][index] || "🏅"}
          ${escapeHTML(player.username)}
        </b>
        <b>${index + 1}. Platz</b>
      </div>
      <p>Gesamtumsatz: ${money(player.total_turnover)}</p>
    </div>
  `).join("") || "Noch keine Spieler.";
}

// ==========================================
// START
// ==========================================

db.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") {
    setTimeout(() => loadAccount(), 0);
  }

  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;
    updateInterface();
  }
});

async function start() {
  await loadLeaderboard();
  await loadAccount();
}

start();
