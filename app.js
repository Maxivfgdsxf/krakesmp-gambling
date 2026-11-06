
const SUPABASE_URL = "https://zrijikvllmotgsixcguc.supabase.co";
const SUPABASE_KEY = "sb_publishable_DVDRAKqYV92NtT1FcYYLLw_UzsR-fZu";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let currentProfile = null;
let isAdmin = false;

const money = n =>
  Number(n).toLocaleString("de-DE") + " Coins";

function showMessage(message) {
  alert(message);
}

// Registrierung
async function register() {
  const username = document.getElementById("username")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;

  if (!username || !email || !password) {
    return showMessage("Bitte alle Felder ausfüllen!");
  }

  if (username.length < 3 || username.length > 20) {
    return showMessage("Der Benutzername muss 3-20 Zeichen haben!");
  }

  if (password.length < 8) {
    return showMessage("Das Passwort muss mindestens 8 Zeichen haben!");
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
      "Account erstellt! Bitte bestätige deine E-Mail, falls erforderlich."
    );
  }

  showMessage("Account erfolgreich erstellt!");
  await loadAccount();
}

// Login
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

  if (error) return showMessage(error.message);

  await loadAccount();
}

// Logout
async function logout() {
  const { error } = await db.auth.signOut();

  if (error) return showMessage(error.message);

  currentUser = null;
  currentProfile = null;
  isAdmin = false;

  location.reload();
}

// Account laden
async function loadAccount() {
  const { data: { user }, error: authError } =
    await db.auth.getUser();

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
    showMessage("Profil konnte nicht geladen werden: " + error.message);
    return;
  }

  currentProfile = profile;

  const { data: adminResult, error: adminError } =
    await db.rpc("krake_is_admin");

  isAdmin = !adminError && adminResult === true;

  updateInterface();
}

// Anzeige aktualisieren
function updateInterface() {
  const loginPanel = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboard");

  if (loginPanel) {
    loginPanel.style.display = currentUser ? "none" : "block";
  }

  if (dashboard) {
    dashboard.style.display = currentUser ? "block" : "none";
  }

  if (!currentProfile) return;

  const name = document.getElementById("profileName");
  const balance = document.getElementById("balance");

  if (name) name.textContent = currentProfile.username;
  if (balance) balance.textContent = money(currentProfile.balance);
}

// Einzahlung beantragen
async function requestDeposit() {
  if (!currentUser) return showMessage("Bitte einloggen!");

  const amount = Number(
    document.getElementById("depositAmount")?.value
  );

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return showMessage("Bitte einen gültigen Betrag eingeben!");
  }

  const { error } = await db.from("krake_deposits").insert({
    user_id: currentUser.id,
    amount
  });

  if (error) return showMessage(error.message);

  showMessage("Einzahlungsanfrage wurde erstellt!");

  const input = document.getElementById("depositAmount");
  if (input) input.value = "";
}

// Profil und Login-Status automatisch laden
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

loadAccount();
