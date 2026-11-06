
async function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

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
  document.getElementById("adminPanel").classList.remove("hidden");
  document.getElementById("status").textContent = "OWNER AKTIV";

  await loadAdminData();
}

async function loadAdminData() {
  const { data: players, error } = await db
    .from("krake_profiles")
    .select("*")
    .order("total_turnover", { ascending: false });

  if (error) return showMessage(error.message);

  document.getElementById("playerCount").textContent =
    players.length;

  document.getElementById("totalBalance").textContent =
    money(players.reduce((sum, p) => sum + Number(p.balance), 0));

  document.getElementById("players").innerHTML =
    players.map(p => `
      <div class="player">
        <b>${escapeHTML(p.username)}</b>
        <p>Guthaben: ${money(p.balance)}</p>
        <p>Umsatz: ${money(p.total_turnover)}</p>
        <input type="number" id="amount-${p.user_id}" placeholder="Coins +/-">
        <button onclick="adjustBalance('${p.user_id}')">
          GUTHABEN ÄNDERN
        </button>
      </div>
    `).join("") || "Keine Spieler vorhanden.";

  await loadDeposits();
  await loadPayouts();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

async function adjustBalance(userId) {
  const input = document.getElementById("amount-" + userId);
  const amount = Number(input.value);

  if (!Number.isSafeInteger(amount) || amount === 0) {
    return showMessage("Ungültiger Betrag!");
  }

  if (!confirm("Guthaben wirklich ändern?")) return;

  const { error } = await db.rpc("krake_owner_adjust_balance", {
    p_user_id: userId,
    p_amount: amount,
    p_description: "Owner-Guthabenänderung"
  });

  if (error) return showMessage(error.message);

  showMessage("Guthaben geändert!");
  await loadAdminData();
}

async function loadDeposits() {
  const { data, error } = await db
    .from("krake_deposits")
    .select("*")
    .eq("status", "pending")
    .order("created_at");

  if (error) return showMessage(error.message);

  document.getElementById("deposits").innerHTML =
    data.map(d => `
      <div class="player">
        <b>${money(d.amount)}</b>
        <p class="small">Spieler-ID: ${escapeHTML(d.user_id)}</p>
        <button onclick="approveDeposit(${d.id})">
          EINZAHLUNG BESTÄTIGEN
        </button>
      </div>
    `).join("") || "Keine offenen Einzahlungen.";
}

async function approveDeposit(id) {
  if (!confirm("Hast du die Minecraft-Zahlung überprüft?")) return;

  const { error } = await db.rpc("krake_owner_approve_deposit", {
    p_deposit_id: id
  });

  if (error) return showMessage(error.message);

  showMessage("Einzahlung bestätigt!");
  await loadAdminData();
}

async function loadPayouts() {
  const { data, error } = await db
    .from("krake_payouts")
    .select("*")
    .eq("status", "pending")
    .order("created_at");

  if (error) return showMessage(error.message);

  document.getElementById("payouts").innerHTML =
    data.map(p => `
      <div class="player">
        <b>${money(p.amount)}</b>
        <p class="small">Spieler-ID: ${escapeHTML(p.user_id)}</p>
        <p class="small">Status: Ausstehend</p>
      </div>
    `).join("") || "Keine offenen Auszahlungen.";
}
