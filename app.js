
// ==========================================
// KRAKESMP - ACCOUNT & STATISTICS SYSTEM
// ==========================================

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
// GLOBALE VARIABLEN
// ==========================================

let currentUser = null;
let currentProfile = null;
let isAdmin = false;
let loadingAccount = false;

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

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

// ==========================================
// SUPABASE VERBINDUNG TESTEN
// ==========================================

async function testSupabase() {
  console.log("KRAKESMP: Prüfe Supabase...");

  const { data, error } = await db
    .from("ks_players")
    .select("id")
    .limit(1);

  if (error) {
    console.error("SUPABASE FEHLER:", error);

    const ranking = document.getElementById("ranking");

    if (ranking) {
      ranking.textContent =
        "Datenbankfehler: " + error.message;
    }

    return false;
  }

  console.log("Supabase erfolgreich verbunden!", data);

  return true;
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
    return showMessage(
      "Benutzername muss 3-20 Zeichen haben!"
    );
  }

  if (password.length < 8) {
    return showMessage(
      "Passwort muss mindestens 8 Zeichen haben!"
    );
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    console.error("REGISTRIERUNGSFEHLER:", error);
    return showMessage(error.message);
  }

  showMessage(
    "Registrierung erfolgreich! Bitte bestätige gegebenenfalls deine E-Mail."
  );

  if (data.session) {
    await loadAccount();
  }
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
    return showMessage(
      "Bitte E-Mail und Passwort eingeben!"
    );
  }

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error("LOGIN FEHLER:", error);
    return showMessage(error.message);
  }

  await loadAccount();

  showMessage("Erfolgreich eingeloggt!");
}

// ==========================================
// LOGOUT
// ==========================================

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    return showMessage(error.message);
  }

  currentUser = null;
  currentProfile = null;
  isAdmin = false;

  updateInterface();

  showMessage("Du wurdest abgemeldet.");
}

// ==========================================
// ACCOUNT LADEN
// ==========================================

async function loadAccount() {
  if (loadingAccount) return;

  loadingAccount = true;

  try {
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
      .from("ks_players")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("PROFILFEHLER:", error);
      showMessage("Profilfehler: " + error.message);
      return;
    }

    if (!profile) {
      currentProfile = null;
      isAdmin = user.id === OWNER_ID;

      updateInterface();

      showMessage(
        "Spielerprofil nicht gefunden. Bitte Owner kontaktieren."
      );

      return;
    }

    currentProfile = profile;
    isAdmin = user.id === OWNER_ID;

    updateInterface();

    await Promise.all([
      loadMyStatistics(),
      loadMyRounds()
    ]);

  } catch (error) {
    console.error("ACCOUNT FEHLER:", error);
  } finally {
    loadingAccount = false;
  }
}

// ==========================================
// INTERFACE
// ==========================================

function updateInterface() {
  const loginPanel =
    document.getElementById("loginPanel");

  const dashboard =
    document.getElementById("dashboard");

  if (loginPanel) {
    loginPanel.style.display =
      currentUser ? "none" : "block";
  }

  if (dashboard) {
    dashboard.style.display =
      currentUser ? "block" : "none";
  }

  setText(
    "profileName",
    currentProfile?.username || ""
  );

  setText(
    "balance",
    money(currentProfile?.balance || 0)
  );

  const adminButton =
    document.getElementById("adminLink");

  if (adminButton) {
    adminButton.style.display =
      isAdmin ? "block" : "none";
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
    console.error("STATISTIKFEHLER:", error);
    return;
  }

  const rounds = data || [];

  const wins =
    rounds.filter(r => r.won === true).length;

  const losses =
    rounds.filter(r => r.won === false).length;

  const winrate = rounds.length
    ? wins / rounds.length * 100
    : 0;

  const totalStake = rounds.reduce(
    (sum, r) => sum + Number(r.stake || 0),
    0
  );

  const totalProfit = rounds.reduce(
    (sum, r) => sum + Number(r.result || 0),
    0
  );

  const totalLoss = rounds
    .filter(r => Number(r.result || 0) < 0)
    .reduce(
      (sum, r) => sum + Math.abs(Number(r.result || 0)),
      0
    );

  setText("myRounds", rounds.length);
  setText("myWins", wins);
  setText("myLosses", losses);
  setText("myWinrate", winrate.toFixed(1) + "%");
  setText("myTotalStake", money(totalStake));
  setText("myProfit", money(totalProfit));
  setText("myLoss", money(totalLoss));
}

// ==========================================
// SPIELHISTORIE
// ==========================================

async function loadMyRounds() {
  if (!currentUser) return;

  const container =
    document.getElementById("myRoundsList");

  if (!container) return;

  const { data, error } = await db
    .from("ks_rounds")
    .select(
      "game_name, stake, result, won, created_at"
    )
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("SPIELHISTORIE FEHLER:", error);

    container.textContent =
      "Spielhistorie konnte nicht geladen werden.";

    return;
  }

  container.innerHTML = (data || [])
    .slice(0, 20)
    .map(round => `
      <div class="player">
        <b>${escapeHTML(round.game_name)}</b>

        <p>Einsatz: ${money(round.stake)}</p>

        <p>Ergebnis: ${money(round.result)}</p>

        <p class="${round.won ? "green" : "red"}">
          ${round.won ? "GEWONNEN" : "VERLOREN"}
        </p>

        <span class="small">
          ${round.created_at
            ? new Date(round.created_at).toLocaleString("de-DE")
            : ""}
        </span>
      </div>
    `).join("") || "Noch keine Statistiken vorhanden.";
}

// ==========================================
// ÖFFENTLICHE RANGLISTE
// ==========================================

async function loadLeaderboard() {
  const container =
    document.getElementById("ranking");

  if (!container) return;

  container.textContent =
    "🏆 Rangliste wird geladen...";

  try {
    const { data, error } = await db
      .from("ks_players")
      .select(
        "id, username, total_profit, total_wins, total_losses, total_rounds"
      )
      .order("total_profit", {
        ascending: false
      });

    if (error) {
      console.error("RANGLISTENFEHLER:", error);

      container.textContent =
        "Rangliste konnte nicht geladen werden: " +
        error.message;

      return;
    }

    if (!data || data.length === 0) {
      container.textContent =
        "Noch keine Spieler vorhanden.";

      return;
    }

    container.innerHTML = data.map((p, i) => {
      const wins = Number(p.total_wins || 0);
      const losses = Number(p.total_losses || 0);

      const total = wins + losses;

      const rate = total
        ? (wins / total * 100).toFixed(1)
        : "0.0";

      return `
        <div class="player">

          <div class="row">
            <b>
              ${["🥇", "🥈", "🥉"][i] || "🏅"}
              ${escapeHTML(p.username)}
            </b>

            <b>${i + 1}. Platz</b>
          </div>

          <p>Profit: ${money(p.total_profit)}</p>

          <p>Winrate: ${rate}%</p>

          <p>
            Siege: ${wins}
            ·
            Niederlagen: ${losses}
          </p>

          <p>
            Runden: ${Number(p.total_rounds || 0)}
          </p>

        </div>
      `;
    }).join("");

    console.log(
      "RANGLISTE ERFOLGREICH GELADEN:",
      data
    );

  } catch (error) {
    console.error("RANGLISTEN AUSNAHME:", error);

    container.textContent =
      "Unerwarteter Fehler beim Laden der Rangliste.";
  }
}

// ==========================================
// AUTH STATUS
// ==========================================

db.auth.onAuthStateChange((event) => {
  console.log("AUTH EVENT:", event);

  if (
    event === "SIGNED_IN" ||
    event === "TOKEN_REFRESHED"
  ) {
    setTimeout(() => {
      loadAccount();
    }, 0);
  }

  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;

    updateInterface();
  }
});

// ==========================================
// START
// ==========================================

async function start() {
  console.log("KRAKESMP STARTET...");

  const connected = await testSupabase();

  if (!connected) return;

  await loadLeaderboard();
  await loadAccount();

  console.log("KRAKESMP BEREIT!");
}

start();
