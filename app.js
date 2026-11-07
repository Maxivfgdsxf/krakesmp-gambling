"use strict";

const CFG = window.KRAKE_CONFIG;
const db = window.supabase.createClient(CFG.supabaseUrl, CFG.publishableKey, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const root = document.getElementById("app");
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const number = (value) => Number(value ?? 0).toLocaleString("de-DE");
const KRAKEN_CREST = `<svg class="kraken-crest" viewBox="0 0 120 120" role="img" aria-label="KRAKE SMP Kraken-Wappen">
  <path d="M30 31 21 10 42 20 60 5 78 20 99 10 90 32" fill="none" stroke="#ff6977" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M33 43 Q60 29 87 43 L84 62 Q81 82 60 88 Q39 82 36 62Z" fill="#e42336" fill-opacity=".16" stroke="#ff5365" stroke-width="3"/>
  <path d="M45 56 Q50 50 55 56 M65 56 Q70 50 75 56" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  <path d="M42 77 C27 81 16 91 19 103 C22 114 35 112 40 101 M54 85 C45 97 47 111 58 114 C66 116 71 109 68 100 M78 77 C93 81 104 91 101 103 C98 114 85 112 80 101" fill="none" stroke="#ff5365" stroke-width="5" stroke-linecap="round"/>
  <path d="M60 86 C63 94 63 100 59 105" fill="none" stroke="#e9b8be" stroke-width="3" stroke-linecap="round"/>
</svg>`;
const dateTime = (value) => value ? new Date(value).toLocaleString("de-DE") : "—";

let currentUser = null;
let profile = null;
let permissions = [];
let currentRoute = "home";
let activeChatChannel = null;
let reactionTimeout = null;
let reactionStartedAt = 0;
let reactionState = "idle";
let adminSection = "overview";
let lastChatMessages = [];

const NAV = [
  ["home","⌂","Startseite","Community"],
  ["chat","◉","Globaler Chat","Community"],
  ["leaderboards","♛","Leaderboards","Community"],
  ["market","◆","Market","Community"],
  ["minigames","⚡","Minigames","Community"],
  ["building","▦","Building Service","Services"],
  ["applications","✧","Team bewerben","Services"],
  ["events","◈","Events","Services"],
  ["profile","◎","Profil","Account"],
  ["settings","⚙","Einstellungen","Account"]
];

function toast(message, kind="info") {
  let node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 3400);
}
function go(route) {
  location.hash = route;
  closeDrawer();
}
function openDrawer() { $("drawer")?.classList.add("open"); }
function closeDrawer() { $("drawer")?.classList.remove("open"); }
function isAdmin() { return permissions.includes("users.view") || permissions.includes("roles.manage"); }
function badge(verified) { return verified ? '<span class="verified" title="Minecraft verifiziert">✓</span>' : ""; }
async function list(table, select="*") {
  const { data, error } = await db.from(table).select(select);
  if (error) throw error;
  return data ?? [];
}
async function countRows(table) {
  const { count, error } = await db.from(table).select("*",{count:"exact",head:true});
  if (error) throw error;
  return count ?? 0;
}
async function callAdmin(command,args={}) {
  const { data,error } = await db.rpc("admin_command",{p_command:command,p_args:args});
  if (error) throw error;
  if (data?.ok !== true) throw new Error(data?.message || "Aktion fehlgeschlagen");
  return data;
}
async function authFunction(payload) {
  const { data, error } = await db.functions.invoke(CFG.authFunction,{body:payload});
  if (error) {
    // Supabase's invoke() often hides the JSON error body behind the generic
    // "Edge Function returned a non-2xx status code" message. Read the
    // response body so users get the real authentication error.
    try {
      const response = error.context;
      if (response && typeof response.clone === "function") {
        const body = await response.clone().json();
        if (body?.error) throw new Error(String(body.error));
      }
    } catch (bodyError) {
      if (bodyError instanceof Error && bodyError.message !== error.message) throw bodyError;
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
async function refreshAuth() {
  const { data:{session} } = await db.auth.getSession();
  currentUser = null; profile = null; permissions = [];
  if (!session) return;
  const { data:{user},error:userError } = await db.auth.getUser();
  if (userError || !user) return;
  currentUser = user;
  const [{data:profileData,error:profileError},{data:permissionData}] = await Promise.all([
    db.from("profiles").select("id,username,display_name,avatar_url,verified,created_at").eq("id",user.id).maybeSingle(),
    db.rpc("my_permissions")
  ]);
  if (profileError) throw profileError;
  profile = profileData;
  permissions = permissionData ?? [];
  const { data:ban } = await db.from("bans").select("id,reason,expires_at")
    .eq("user_id",user.id).eq("active",true).order("starts_at",{ascending:false}).limit(1).maybeSingle();
  if (ban && (!ban.expires_at || new Date(ban.expires_at)>new Date())) {
    await db.auth.signOut();
    currentUser = null; profile = null; permissions = [];
    throw new Error("Dein Account ist gesperrt: " + ban.reason);
  }
}
function shell(content) {
  const display = profile?.display_name || profile?.username || "Gast";
  const nav = NAV.map(([route,icon,label,group]) =>
    '<button class="nav-link '+(currentRoute===route?'active':'')+'" data-route="'+route+'"><span class="nav-icon">'+icon+'</span>'+label+'</button>'
  ).join("");
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="menu-open" aria-label="Menü öffnen">☰</button>
      <a class="brand" href="#home"><span class="brand-logo" aria-hidden="true">${KRAKEN_CREST}</span><span>KRAKE SMP</span></a>
      <div class="top-actions">
        <span class="account-chip">${esc(display)}</span>
        <button class="icon-btn" id="account-open" aria-label="Profil öffnen">◎</button>
      </div>
    </header>
    <div class="drawer" id="drawer">
      <div class="drawer-backdrop" id="drawer-back"></div>
      <aside class="drawer-panel">
        <div class="drawer-head"><span class="drawer-title">KRAKE NAVIGATION</span><button class="icon-btn" id="menu-close" aria-label="Menü schließen">×</button></div>
        <nav class="nav-list">
          <div class="nav-label">Community</div>
          ${nav.split('</button>').slice(0,5).map(x=>x+'</button>').join("")}
          <div class="nav-label">Services</div>
          ${nav.split('</button>').slice(5,8).map(x=>x+'</button>').join("")}
          <div class="nav-label">Account</div>
          ${nav.split('</button>').slice(8).map(x=>x+'</button>').join("")}
          ${isAdmin()?'<div class="nav-label">Administration</div><button class="nav-link '+(currentRoute==="admin"?'active':'')+'" data-route="admin"><span class="nav-icon">✦</span>Admin Panel</button>':""}
          <button class="nav-link" id="auth-nav"><span class="nav-icon">${currentUser?"↪":"→"}</span>${currentUser?"Abmelden":"Anmelden"}</button>
        </nav>
      </aside>
    </div>
    <main class="page-wrap" id="page-content">${content}</main>
    <footer class="site-footer">KRAKE SMP · COMMUNITY PORTAL · BUILT FOR THE COMMUNITY</footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;
  $("menu-open").onclick=openDrawer;
  $("menu-close").onclick=closeDrawer;
  $("drawer-back").onclick=closeDrawer;
  $("account-open").onclick=()=>go(currentUser?"profile":"login");
  $("auth-nav").onclick=async()=>{
    if (!currentUser) return go("login");
    await db.auth.signOut(); await refreshAuth(); go("home"); await render();
  };
  root.querySelectorAll("[data-route]").forEach(button=>button.addEventListener("click",()=>go(button.dataset.route)));
}
function pageHead(eyebrow,title,desc="") {
  return '<div class="page-head"><div class="eyebrow">'+esc(eyebrow)+'</div><h1>'+esc(title)+'</h1>'+(desc?'<p>'+esc(desc)+'</p>':"")+'</div>';
}
function empty(message) { return '<div class="empty">'+esc(message)+'</div>'; }

async function renderHome() {
  const [events,announcements] = await Promise.all([
    db.from("events").select("name,description,starts_at,ends_at").eq("active",true).limit(1),
    db.from("announcements").select("title,message,created_at").eq("active",true).order("created_at",{ascending:false}).limit(2)
  ]);
  const event = events.data?.[0];
  const hello = profile?.display_name || profile?.username || "Spieler";
  const announcementHtml = (announcements.data??[]).map(a=>'<article class="list-item"><div class="item-title">'+esc(a.title)+'</div><p>'+esc(a.message)+'</p><div class="inline-meta">'+dateTime(a.created_at)+'</div></article>').join("");
  return `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">KRAKE SMP · COMMUNITY PORTAL</div>
        <h1>DEINE <span class="red-word">KRAKE</span><span>COMMUNITY.</span></h1>
        <p class="lead">Alles an einem Ort. Triff deine Community im Chat, vergleiche deine Stats, bewirb dich fürs Team und verwalte deine Minecraft-Verknüpfung.</p>
        <div class="action-row">
          <button class="btn" data-route="chat">Zum Community-Chat <span>→</span></button>
          <button class="btn secondary" data-route="leaderboards">Rankings ansehen</button>
        </div>
        ${currentUser?'<p class="muted">Willkommen zurück, <strong>'+esc(hello)+'</strong>.</p>':'<p class="muted">Neu hier? Erstelle deinen Community-Account in wenigen Schritten.</p>'}
      </div>
      <aside class="panel hero-panel">
        <div class="status-line"><span class="status-dot"></span> PORTAL BEREIT</div>
        <div class="crest-orb">${KRAKEN_CREST}</div>
        <div class="panel-footer"><span>🛡 KRAKE SMP</span><span class="pill red">COMMUNITY HUB</span></div>
        <p class="form-note">Der Live-Status des Minecraft-Servers wird verbunden, sobald die Server-API bereitsteht.</p>
      </aside>
    </section>
    <section class="section grid two">
      <div class="card"><div class="section-head"><div><div class="eyebrow">SEASONAL</div><h2>Aktuelles Event</h2></div><span class="pill ${event?"red":""}">${event?"LIVE":"YEAR ROUND"}</span></div>
        <h3>${esc(event?.name||"KRAKE Community")}</h3><p>${esc(event?.description||"Hier erscheinen aktuelle Server-Specials, Community-Events und saisonale Aktionen. Das Grunddesign bleibt das ganze Jahr über aktiv.")}</p>
        <button class="btn secondary small" data-route="events">Alle Events</button>
      </div>
      <div class="card"><div class="section-head"><div><div class="eyebrow">PLAYER SERVICES</div><h2>Community Services</h2></div><span class="pill">V1</span></div>
        <div class="list"><div class="item-head"><span>🏗 Building Service</span><button class="btn ghost small" data-route="building">Öffnen</button></div><div class="item-head"><span>✧ Team bewerben</span><button class="btn ghost small" data-route="applications">Öffnen</button></div><div class="item-head"><span>⚙ Minecraft verbinden</span><button class="btn ghost small" data-route="settings">Öffnen</button></div></div>
      </div>
    </section>
    ${announcementHtml?'<section class="section"><div class="section-head"><div><div class="eyebrow">NEWS</div><h2>Neuigkeiten</h2></div></div><div class="list">'+announcementHtml+'</div></section>':""}
  `;
}

async function renderLogin() {
  if (currentUser) return '<div class="card auth-card"><div class="eyebrow">ACCOUNT</div><h2>Du bist angemeldet</h2><p class="muted">Angemeldet als '+esc(profile?.username||"Player")+'.</p><button class="btn" data-route="profile">Zum Profil</button></div>';
  return `
    <section class="card auth-card">
      <div class="eyebrow">KRAKE ACCOUNT</div><h2 id="auth-title">Anmelden</h2>
      <p class="muted">Benutzername und Passwort. Kein E-Mail-Postfach und keine Zwei-Faktor-Pflicht.</p>
      <div class="auth-switch"><button class="btn" id="tab-login">Anmelden</button><button class="btn secondary" id="tab-signup">Account erstellen</button></div>
      <form class="form" id="auth-form">
        <div class="field"><label for="auth-username">Benutzername</label><input class="input" id="auth-username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" required></div>
        <div class="field"><label for="auth-password">Passwort</label><input class="input" id="auth-password" name="password" type="password" minlength="12" autocomplete="current-password" required></div>
        <div id="signup-confirm" class="field hidden"><label for="auth-confirm">Passwort wiederholen</label><input class="input" id="auth-confirm" type="password" minlength="12" autocomplete="new-password"></div>
        <button class="btn" id="auth-submit">Einloggen</button>
      </form>
      <div class="form-note" id="auth-message" aria-live="polite">Passwörter müssen mindestens 12 Zeichen mit Groß-/Kleinbuchstaben, Zahl und Sonderzeichen enthalten.</div>
    </section>
  `;
}

async function renderChat() {
  const messages = await db.from("chat_messages")
    .select("id,user_id,message,created_at,profiles(username,verified)")
    .is("deleted_at",null).order("created_at",{ascending:true}).limit(100);
  if (messages.error) throw messages.error;
  lastChatMessages = messages.data??[];
  const items = lastChatMessages.map(m=>`
    <article class="chat-message">
      <div><span class="who">${esc(m.username||"Player")}${badge(m.profiles?.verified)}</span><span class="when">${dateTime(m.created_at)}</span>
      ${currentUser && currentUser.id!==m.user_id?'<button class="btn ghost small" data-report="'+m.id+'">Melden</button>':""}</div>
      <p>${esc(m.message)}</p>
    </article>
  `).join("");
  return pageHead("COMMUNITY","Globaler Chat","Schreib mit der KRAKE Community. Chat-Regeln gelten für alle Mitglieder.")+
    '<section class="card"><div class="chat-window" id="chat-window">'+(items||empty("Noch keine Nachrichten. Starte die Unterhaltung!"))+'</div>'+
    (currentUser?'<form id="chat-form" class="chat-compose"><input class="input" id="chat-input" maxlength="2000" placeholder="Nachricht schreiben …" required><button class="btn">Senden</button></form>':'<div class="notice" style="margin-top:12px">Zum Schreiben bitte <button class="btn small" data-route="login">anmelden</button>.</div>')+
    '<p class="form-note">Nachrichten werden moderiert. Melde problematische Inhalte über „Melden“.</p></section>';
}

async function renderLeaderboards() {
  const {data,error}=await db.from("player_statistics")
    .select("user_id,games_played,wins,losses,best_time_ms,total_score,rating,profiles(username,verified)")
    .order("rating",{ascending:false}).limit(100);
  if(error) throw error;
  const body=(data??[]).map((p,i)=>'<tr><td><span class="rank '+(i===0?"gold":i===1?"silver":i===2?"bronze":"")+'">'+(i+1)+'</span></td><td>'+esc(p.profiles?.username||"Player")+badge(p.profiles?.verified)+'</td><td>'+number(p.rating)+'</td><td>'+number(p.wins)+'</td><td>'+number(p.games_played)+'</td><td>'+number(p.total_score)+'</td></tr>').join("");
  return pageHead("COMPETITIVE","Leaderboards","Ratings und Statistiken der KRAKE Community.")+
    (body?'<div class="table-wrap"><table><thead><tr><th>Rang</th><th>Spieler</th><th>Rating</th><th>Wins</th><th>Games</th><th>Score</th></tr></thead><tbody>'+body+'</tbody></table></div>':empty("Noch keine Spieler-Statistiken vorhanden."));
}

async function renderMarket() {
  const [items,prices,balance] = await Promise.all([
    db.from("market_items").select("id,symbol,name,description").eq("active",true).order("symbol"),
    db.from("market_prices").select("item_id,price,created_at").order("created_at",{ascending:false}).limit(300),
    currentUser?db.from("user_balances").select("balance").eq("user_id",currentUser.id).maybeSingle():Promise.resolve({data:null})
  ]);
  if(items.error)throw items.error;if(prices.error)throw prices.error;if(balance.error)throw balance.error;
  const latest=new Map();for(const p of (prices.data??[])){if(!latest.has(p.item_id))latest.set(p.item_id,p)}
  const cards=(items.data??[]).map(item=>{const price=latest.get(item.id);return '<article class="card"><div class="market-symbol">'+esc(item.symbol)+'</div><h2>'+esc(item.name)+'</h2><p>'+esc(item.description||"Fiktives virtuelles Asset.")+'</p><div class="market-price">'+number(price?.price??0)+' ◆</div><div class="trend">Letztes Update: '+dateTime(price?.created_at)+'</div></article>'}).join("");
  return pageHead("VIRTUAL ECONOMY","Market","Fiktive Ingame-Website-Werte. Kein Echtgeld, keine Ein- oder Auszahlungen, kein Geldwert.")+
    '<div class="section grid two"><div class="card"><div class="stat-label">Dein Guthaben</div><div class="stat-number">'+number(balance.data?.balance??0)+' ◆</div><p class="form-note">Virtuelle Community-Währung</p></div><div class="notice">Der Markt ist ein reines Spielsystem. Echtgeldhandel, Auszahlungen und Umtausch in Minecraft-Währung sind nicht vorgesehen.</div></div>'+
    '<div class="section grid">'+(cards||empty("Noch keine Markt-Assets vorhanden."))+'</div>';
}

async function renderMinigames() {
  const {data:games,error}=await db.from("minigames").select("id,slug,name,description").eq("active",true).order("name");
  if(error)throw error;
  const reaction=(games??[]).find(g=>g.slug==="reaction");
  const tiles=(games??[]).filter(g=>g.slug!=="reaction").map(g=>'<article class="card"><span class="pill">CHALLENGE</span><h2>'+esc(g.name)+'</h2><p>'+esc(g.description||"Challenge")+'</p><span class="form-note">Dieses Minigame folgt in einem späteren Update.</span></article>').join("");
  return pageHead("QUICK COMPETITION","Minigames","Kurze Skill-Challenges mit Stats, Wins und Leaderboard.")+
    '<section class="card"><div class="section-head"><div><div class="eyebrow">LIVE CHALLENGE</div><h2>Reaction Test</h2><p>Warte bis die Fläche grün wird und klicke dann so schnell wie möglich.</p></div><span class="pill green">SPIELBAR</span></div>'+
    '<div class="reaction-box"><div><div id="reaction-result" class="muted">Bereit für deinen Reaktionstest?</div><button id="reaction-button" class="btn reaction-button">Challenge starten</button><div class="form-note" style="margin-top:12px">Dein Ergebnis wird mit deinem Account gespeichert.</div></div></div></section>'+
    '<section class="section grid">'+(tiles||empty("Weitere Minigames sind für Update 1.3 vorbereitet."))+'</section>';
}

async function renderEvents() {
  const {data,error}=await db.from("events").select("name,description,banner_url,starts_at,ends_at,active,config").order("starts_at",{ascending:false});
  if(error)throw error;
  const items=(data??[]).map(e=>'<article class="card"><div class="item-head"><span class="pill '+(e.active?"red":"")+'">'+(e.active?"AKTIV":"GEPLANT")+'</span><span class="form-note">'+dateTime(e.starts_at)+'</span></div><h2 style="margin-top:14px">'+esc(e.name)+'</h2><p>'+esc(e.description||"Weitere Informationen folgen.")+'</p>'+(e.ends_at?'<div class="form-note">Endet: '+dateTime(e.ends_at)+'</div>':"")+'</article>').join("");
  return pageHead("SEASONAL","Events","Jahreszeiten, SMP-Specials und Community-Aktionen.")+'<div class="grid">'+(items||empty("Momentan ist kein Event eingetragen. Das Portal bleibt das ganze Jahr über im KRAKE-Design."))+'</div>';
}

async function renderBuilding() {
  if(!currentUser)return pageHead("PLAYER SERVICE","Building Service","Reiche deinen Bauauftrag ein und bespreche Details privat mit dem Team.")+'<div class="card">'+empty("Melde dich an, um einen Building-Auftrag zu erstellen.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  const {data:orders,error}=await db.from("building_orders").select("id,title,description,budget,status,created_at").eq("user_id",currentUser.id).order("created_at",{ascending:false});
  if(error)throw error;
  const messageResults=await Promise.all((orders??[]).map(async o=>{
    const {data,error}=await db.rpc("building_message_history",{p_order_id:o.id});
    if(error)throw error;return data??[];
  }));
  const orderMessages=messageResults.flat();
  const cards=(orders??[]).map(o=>{
    const history=orderMessages.filter(m=>m.order_id===o.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.username||"Team")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
    return '<article class="list-item"><div class="item-head"><strong>'+esc(o.title)+'</strong><span class="pill">'+esc(o.status)+'</span></div><p>'+esc(o.description)+'</p><div class="inline-meta">Budget: '+(o.budget===null?"Offen":number(o.budget)+" ◆")+' · '+dateTime(o.created_at)+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch keine Nachrichten vom Team.</div>')+'</div><form class="chat-compose" data-building-message="'+o.id+'"><input class="input" name="message" maxlength="2000" placeholder="Nachricht an das Team …" required><button class="btn small">Senden</button></form></article>';
  }).join("");
  return pageHead("PLAYER SERVICE","Building Service","Was soll gebaut werden? Das Team kann den Status aktualisieren und mit dir schreiben.")+
    '<div class="grid two"><section class="card"><h2>Neuen Auftrag erstellen</h2><form class="form" id="building-form"><div class="field"><label>Titel</label><input class="input" name="title" maxlength="100" required></div><div class="field"><label>Beschreibung</label><textarea name="description" maxlength="4000" required></textarea></div><div class="field"><label>Budget in ◆ (optional)</label><input class="input" name="budget" type="number" min="0"></div><button class="btn">Auftrag senden</button></form></section><section class="card"><h2>Deine Aufträge</h2><div class="list">'+(cards||empty("Du hast noch keine Aufträge erstellt."))+'</div></section></div>';
}

async function renderApplications() {
  if(!currentUser)return pageHead("JOIN THE TEAM","Team bewerben","Bewirb dich als Helper, Moderator oder Media.")+'<div class="card">'+empty("Melde dich an, um dich fürs Team zu bewerben.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  const {data,error}=await db.from("applications").select("id,desired_role,reason,experience,status,created_at").eq("user_id",currentUser.id).order("created_at",{ascending:false});
  if(error)throw error;
  const messageResults=await Promise.all((data??[]).map(async a=>{
    const {data,error}=await db.rpc("application_message_history",{p_application_id:a.id});
    if(error)throw error;return (data??[]).map(m=>({...m,application_id:a.id}));
  }));
  const applicationMessages=messageResults.flat();
  const cards=(data??[]).map(a=>{
    const history=applicationMessages.filter(m=>m.application_id===a.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.profiles?.username||"Team")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
    return '<article class="list-item"><div class="item-head"><strong>'+esc(a.desired_role)+'</strong><span class="pill">'+esc(a.status)+'</span></div><p>'+esc(a.reason)+'</p><div class="inline-meta">'+dateTime(a.created_at)+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch keine Rückfragen vom Team.</div>')+'</div><form class="chat-compose" data-application-message="'+a.id+'"><input class="input" name="message" maxlength="2000" placeholder="Nachricht zur Bewerbung …" required><button class="btn small">Senden</button></form></article>';
  }).join("");
  return pageHead("JOIN THE TEAM","Team bewerben","Team-Anträge sind nur für Teamrollen vorgesehen. Das Team prüft deine Bewerbung.")+
    '<div class="grid two"><section class="card"><h2>Bewerbung erstellen</h2><form class="form" id="application-form"><div class="field"><label>Gewünschte Rolle</label><select name="desired_role"><option value="helper">Helper</option><option value="moderator">Moderator</option><option value="media">Media</option></select></div><div class="field"><label>Warum möchtest du ins Team?</label><textarea name="reason" minlength="30" maxlength="4000" required></textarea></div><div class="field"><label>Erfahrung (optional)</label><textarea name="experience" maxlength="3000"></textarea></div><button class="btn">Bewerbung senden</button></form></section><section class="card"><h2>Deine Bewerbungen</h2><div class="list">'+(cards||empty("Noch keine Bewerbungen vorhanden."))+'</div></section></div>';
}

async function renderProfile() {
  if(!currentUser)return pageHead("ACCOUNT","Profil","Melde dich an, um dein Profil anzusehen.")+'<div class="card">'+empty("Du bist noch nicht angemeldet.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  const [balance,stats,minecraft,roles]=await Promise.all([
    db.from("user_balances").select("balance").eq("user_id",currentUser.id).maybeSingle(),
    db.from("player_statistics").select("*").eq("user_id",currentUser.id).maybeSingle(),
    db.from("minecraft_accounts").select("minecraft_name,verification_status,verified_at").eq("user_id",currentUser.id).maybeSingle(),
    db.from("user_roles").select("roles(display_name,name)").eq("user_id",currentUser.id)
  ]);
  const roleNames=(roles.data??[]).map(r=>r.roles?.display_name||r.roles?.name).filter(Boolean).join(", ")||"User";
  return pageHead("PLAYER ID","Profil","Deine KRAKE SMP Community-Identität.")+
    '<section class="card"><div class="item-head"><div><div class="eyebrow">MEMBER PROFILE</div><h2>'+esc(profile?.display_name||profile?.username||"Player")+badge(profile?.verified)+'</h2><div class="muted">@'+esc(profile?.username||"")+'</div></div><span class="pill red">'+esc(roleNames)+'</span></div><div class="section grid four"><div class="card stat-card"><div class="stat-label">Wins</div><div class="stat-number">'+number(stats.data?.wins)+'</div></div><div class="card stat-card"><div class="stat-label">Games</div><div class="stat-number">'+number(stats.data?.games_played)+'</div></div><div class="card stat-card"><div class="stat-label">Rating</div><div class="stat-number">'+number(stats.data?.rating??1000)+'</div></div><div class="card stat-card"><div class="stat-label">Wallet</div><div class="stat-number">'+number(balance.data?.balance)+' ◆</div></div></div><div class="section grid two"><div class="list-item"><div class="muted">Minecraft Account</div><strong>'+esc(minecraft.data?.minecraft_name||"Nicht verknüpft")+'</strong><div class="inline-meta">Status: '+esc(minecraft.data?.verification_status||"unverified")+'</div></div><div class="list-item"><div class="muted">Mitglied seit</div><strong>'+dateTime(profile?.created_at)+'</strong><div class="inline-meta">Letzter Login: '+dateTime(profile?.last_login_at)+'</div></div></div><div class="action-row"><button class="btn secondary" data-route="settings">Einstellungen</button><button class="btn ghost" id="logout-btn">Abmelden</button></div></section>';
}

async function renderSettings() {
  if(!currentUser)return pageHead("ACCOUNT CONTROL","Einstellungen","Melde dich an, um deine Einstellungen zu verwalten.")+'<div class="card">'+empty("Bitte zuerst anmelden.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  const {data:mc}=await db.from("minecraft_accounts").select("minecraft_name,verification_status,verified_at").eq("user_id",currentUser.id).maybeSingle();
  const {data:req}=await db.from("verification_requests").select("minecraft_name,status,requested_at").eq("user_id",currentUser.id).order("requested_at",{ascending:false}).limit(1).maybeSingle();
  return pageHead("ACCOUNT CONTROL","Einstellungen","Profil, Minecraft-Verknüpfung und Sicherheit.")+
    '<div class="grid two"><section class="card"><h2>Profil bearbeiten</h2><form class="form" id="profile-form"><div class="field"><label>Anzeigename</label><input class="input" name="display_name" maxlength="32" value="'+esc(profile?.display_name||profile?.username||"")+'"></div><button class="btn">Speichern</button></form></section><section class="card"><h2>Minecraft Account</h2><p class="muted">Die Eingabe eines Namens ist keine automatische Verifizierung. Das Team prüft jeden Antrag manuell.</p><div class="notice">Aktueller Status: <strong>'+esc(mc?.verification_status||req?.status||"Nicht verifiziert")+'</strong>'+(mc?.minecraft_name?' · '+esc(mc.minecraft_name):req?.minecraft_name?' · '+esc(req.minecraft_name):"")+'</div><form class="form" id="verification-form" style="margin-top:12px"><div class="field"><label>Minecraft Java Name</label><input class="input" name="minecraft_name" pattern="[A-Za-z0-9_]{3,16}" maxlength="16" required placeholder="DeinMinecraftName"></div><button class="btn">Verifizierung anfordern</button></form></section><section class="card"><h2>Sicherheit</h2><p class="muted">Passwörter werden ausschließlich von Supabase Auth gehasht gespeichert. Admins können ein Passwort zurücksetzen, aber niemals dein Klartext-Passwort auslesen.</p><div class="pill green">Sichere Sessions aktiv</div><div class="pill">Kein 2FA-Zwang</div></section><section class="card"><h2>Account</h2><p class="muted">Username: <strong>'+esc(profile?.username||"")+'</strong><br>Erstellt: '+dateTime(profile?.created_at)+'</p><button class="btn ghost" id="settings-logout">Abmelden</button></section></div>';
}

async function renderAdmin() {
  if(!currentUser)return pageHead("RESTRICTED","Admin Panel","Nur für autorisierte Teammitglieder.")+'<div class="card">'+empty("Bitte anmelden.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  if(!isAdmin())return pageHead("RESTRICTED","Kein Zugriff","Dein Account besitzt keine Admin-Berechtigung.")+'<div class="card">'+empty("Das Admin Panel ist serverseitig geschützt.")+'</div>';
  return pageHead("CONTROL CENTER","Admin Panel","Serverseitig abgesicherte Verwaltung und Audit-Protokoll.")+
    '<section class="card"><div class="admin-tabs">'+[
      ["overview","Dashboard"],["players","Players"],["bans","Bans"],["verifications","Minecraft"],["applications","Bewerbungen"],["building","Building"],["market","Market"],["chat","Chat Reports"],["roles","Rollen"],["audit","Audit Logs"],["maintenance","Maintenance"],["console","Admin Console"]
    ].map(([k,v])=>'<button data-admin-tab="'+k+'" class="'+(adminSection===k?"active":"")+'">'+v+'</button>').join("")+'</div><div id="admin-content" class="admin-layout">'+empty("Bereich wird geladen …")+'</div></section>';
}

async function renderPage() {
  if(activeChatChannel){await db.removeChannel(activeChatChannel);activeChatChannel=null;}
  if(reactionTimeout){clearTimeout(reactionTimeout);reactionTimeout=null;}
  const route=(location.hash.slice(1)||"home").split("?")[0].split("/")[0];
  currentRoute=route;
  let content="";
  try {
    if(route==="login")content=await renderLogin();
    else if(route==="chat")content=await renderChat();
    else if(route==="leaderboards")content=await renderLeaderboards();
    else if(route==="market")content=await renderMarket();
    else if(route==="minigames")content=await renderMinigames();
    else if(route==="events")content=await renderEvents();
    else if(route==="building")content=await renderBuilding();
    else if(route==="applications")content=await renderApplications();
    else if(route==="profile")content=await renderProfile();
    else if(route==="settings")content=await renderSettings();
    else if(route==="admin")content=await renderAdmin();
    else {currentRoute="home";content=await renderHome();}
  } catch(error) {
    console.error(error);
    content='<section class="card"><div class="eyebrow">SYSTEM</div><h2>Dieser Bereich konnte nicht geladen werden.</h2><p class="muted">'+esc(error.message)+'</p><button class="btn secondary" data-route="home">Zur Startseite</button></section>';
  }
  shell(content);
  wirePage(route);
  if(route==="admin" && isAdmin()) await loadAdminSection(adminSection);
}

function wirePage(route) {
  if(route==="login")wireLogin();
  if(route==="chat")wireChat();
  if(route==="minigames")wireReaction();
  if(route==="building")wireBuilding();
  if(route==="applications")wireApplications();
  if(route==="profile")$("logout-btn")?.addEventListener("click",logout);
  if(route==="settings")wireSettings();
  if(route==="admin")wireAdmin();
}
async function logout(){await db.auth.signOut();await refreshAuth();go("home");await renderPage();toast("Du wurdest abgemeldet.");}

function wireLogin() {
  let mode="login";
  const setMode=(next)=>{
    mode=next;
    $("auth-title").textContent=mode==="login"?"Anmelden":"Account erstellen";
    $("auth-submit").textContent=mode==="login"?"Einloggen":"Account erstellen";
    $("signup-confirm").classList.toggle("hidden",mode==="login");
    $("auth-password").autocomplete=mode==="login"?"current-password":"new-password";
    $("tab-login").className=mode==="login"?"btn":"btn secondary";
    $("tab-signup").className=mode==="signup"?"btn":"btn secondary";
    $("auth-message").textContent=mode==="login"?"Melde dich mit deinem Benutzernamen und Passwort an.":"Mindestens 12 Zeichen, Groß-/Kleinbuchstaben, Zahl und Sonderzeichen.";
  };
  $("tab-login").onclick=()=>setMode("login");
  $("tab-signup").onclick=()=>setMode("signup");
  $("auth-form").onsubmit=async(event)=>{
    event.preventDefault();
    const username=$("auth-username").value.trim().toLowerCase();
    const password=$("auth-password").value;
    const msg=$("auth-message");
    if(!/^[a-z0-9_]{3,20}$/.test(username)){msg.textContent="Ungültiger Benutzername.";return;}
    if(mode==="signup" && $("auth-confirm").value!==password){msg.textContent="Die Passwörter stimmen nicht überein.";return;}
    const button=$("auth-submit");button.disabled=true;msg.textContent="Bitte warten …";
    try{
      if(mode==="signup"){
        await authFunction({action:"signup",username,password});
      }
      const response=await authFunction({action:"login",username,password});
      await db.auth.setSession(response.session);
      await refreshAuth();
      go("home");await renderPage();toast(mode==="signup"?"Account erstellt. Willkommen bei KRAKE SMP!":"Erfolgreich angemeldet.","success");
    }catch(error){msg.textContent=error.message;button.disabled=false;}
  };
}
async function loadChatMessages() {
  const {data,error}=await db.from("chat_messages").select("id,user_id,message,created_at,profiles(username,verified)")
    .is("deleted_at",null).order("created_at",{ascending:true}).limit(100);
  if(error)throw error;
  const node=$("chat-window");if(!node)return;
  node.innerHTML=(data??[]).map(m=>'<article class="chat-message"><div><span class="who">'+esc(m.profiles?.username||"Player")+badge(m.profiles?.verified)+'</span><span class="when">'+dateTime(m.created_at)+'</span>'+(currentUser&&currentUser.id!==m.user_id?'<button class="btn ghost small" data-report="'+m.id+'">Melden</button>':"")+'</div><p>'+esc(m.message)+'</p></article>').join("")||empty("Noch keine Nachrichten. Starte die Unterhaltung!");
  node.scrollTop=node.scrollHeight;
}
function wireChat() {
  $("chat-form")?.addEventListener("submit",async event=>{
    event.preventDefault();if(!currentUser)return;
    const input=$("chat-input");const message=input.value.trim();if(!message)return;
    const {error}=await db.from("chat_messages").insert({user_id:currentUser.id,message});
    if(error){toast(error.message);return;}
    input.value="";await loadChatMessages();
  });
  $("chat-window")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-report]");if(!button||!currentUser)return;
    const reason=prompt("Warum möchtest du diese Nachricht melden?");if(!reason)return;
    const {error}=await db.from("chat_reports").insert({message_id:Number(button.dataset.report),reporter_user_id:currentUser.id,reason});
    toast(error?error.message:"Nachricht wurde gemeldet.",error?"error":"success");
  });
  activeChatChannel=db.channel("krake-global-chat").on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages"},()=>loadChatMessages().catch(console.error)).subscribe();
}
function wireReaction() {
  const button=$("reaction-button");if(!button)return;
  button.addEventListener("click",async()=>{
    if(!currentUser){go("login");return;}
    const result=$("reaction-result");
    if(reactionState==="idle"){
      reactionState="waiting";button.className="btn reaction-button waiting";button.textContent="Warte …";result.textContent="Nicht zu früh klicken!";
      reactionTimeout=setTimeout(()=>{reactionState="ready";reactionStartedAt=performance.now();button.className="btn reaction-button ready";button.textContent="JETZT KLICKEN";result.textContent="LOS!";},1500+Math.random()*2500);
    }else if(reactionState==="waiting"){
      clearTimeout(reactionTimeout);reactionTimeout=null;reactionState="idle";button.className="btn reaction-button early";button.textContent="Zu früh!";
      result.textContent="Fehlstart! Versuche es erneut.";
    }else if(reactionState==="ready"){
      const ms=Math.round(performance.now()-reactionStartedAt);reactionState="idle";button.className="btn reaction-button";button.textContent="Nochmal spielen";
      result.textContent="Deine Zeit: "+ms+" ms";
      const {data:game}=await db.from("minigames").select("id").eq("slug","reaction").single();
      if(game){const {error}=await db.from("minigame_results").insert({minigame_id:game.id,user_id:currentUser.id,time_ms:ms,score:Math.max(0,1000-ms),won:true,metadata:{client:"web-v1"}});if(error)toast("Ergebnis konnte nicht gespeichert werden: "+error.message);else toast("Ergebnis gespeichert!","success");}
    }
  });
}
function wireBuilding() {
  $("building-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get("title")||"").trim();const description=String(f.get("description")||"").trim();const raw=String(f.get("budget")||"");const budget=raw===""?null:Number(raw);
    if(!title||!description|| (budget!==null&&(!Number.isSafeInteger(budget)||budget<0)))return;
    const {error}=await db.from("building_orders").insert({user_id:currentUser.id,title,description,budget});
    if(error)toast(error.message,"error");else{toast("Building-Auftrag gesendet.","success");await renderPage();}
  });
  document.querySelectorAll("[data-building-message]").forEach(form=>form.addEventListener("submit",async e=>{
    e.preventDefault();const message=new FormData(form).get("message");const orderId=Number(form.dataset.buildingMessage);
    const {error}=await db.from("building_messages").insert({order_id:orderId,user_id:currentUser.id,message:String(message||"").trim()});
    if(error)toast(error.message,"error");else{form.reset();toast("Nachricht gesendet.","success");}
  }));
}
function wireApplications() {
  $("application-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const values={user_id:currentUser.id,desired_role:String(f.get("desired_role")),reason:String(f.get("reason")||"").trim(),experience:String(f.get("experience")||"").trim()||null};
    const {error}=await db.from("applications").insert(values);
    if(error)toast(error.message,"error");else{toast("Bewerbung gesendet.","success");await renderPage();}
  });
  document.querySelectorAll("[data-application-message]").forEach(form=>form.addEventListener("submit",async e=>{
    e.preventDefault();const message=new FormData(form).get("message");const applicationId=Number(form.dataset.applicationMessage);
    const {error}=await db.from("application_messages").insert({application_id:applicationId,user_id:currentUser.id,message:String(message||"").trim()});
    if(error)toast(error.message,"error");else{form.reset();toast("Nachricht zur Bewerbung gesendet.","success");await renderPage();}
  }));
}
function wireSettings() {
  $("profile-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const display_name=String(new FormData(e.currentTarget).get("display_name")||"").trim();
    const {error}=await db.from("profiles").update({display_name,updated_at:new Date().toISOString()}).eq("id",currentUser.id);
    if(error)toast(error.message,"error");else{await refreshAuth();toast("Profil gespeichert.","success");await renderPage();}
  });
  $("verification-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const minecraft_name=String(new FormData(e.currentTarget).get("minecraft_name")||"").trim();
    if(!/^[A-Za-z0-9_]{3,16}$/.test(minecraft_name)){toast("Minecraft-Name ungültig.","error");return;}
    const {error}=await db.from("verification_requests").insert({user_id:currentUser.id,minecraft_name});
    if(error)toast(error.message,"error");else{toast("Verifizierungsantrag an das Team gesendet.","success");await renderPage();}
  });
  $("settings-logout")?.addEventListener("click",logout);
}

function wireAdmin() {
  document.querySelectorAll("[data-admin-tab]").forEach(button=>button.addEventListener("click",async()=>{
    adminSection=button.dataset.adminTab;
    document.querySelectorAll("[data-admin-tab]").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===adminSection));
    await loadAdminSection(adminSection);
  }));
}
async function loadAdminSection(section) {
  const node=$("admin-content");if(!node)return;
  node.innerHTML=empty("Lade Daten …");
  try {
    if(section==="overview"){
      const [players,bans,verifications,applications,orders,reports]=await Promise.all([
        countRows("profiles"),countRows("bans"),countRows("verification_requests"),countRows("applications"),countRows("building_orders"),countRows("chat_reports")
      ]);
      node.innerHTML='<div class="grid four"><div class="card stat-card"><div class="stat-label">Spieler</div><div class="stat-number">'+players+'</div></div><div class="card stat-card"><div class="stat-label">Bans</div><div class="stat-number">'+bans+'</div></div><div class="card stat-card"><div class="stat-label">Verifizierungen</div><div class="stat-number">'+verifications+'</div></div><div class="card stat-card"><div class="stat-label">Reports</div><div class="stat-number">'+reports+'</div></div></div><div class="card"><h2>Admin-Bereich bereit</h2><p class="muted">Jede privilegierte Aktion wird serverseitig geprüft und in Audit Logs gespeichert. Nutze die Tabs, um Spieler, Anträge, Chat und Website-Einstellungen zu verwalten.</p><span class="pill green">RLS aktiv</span> <span class="pill green">RBAC aktiv</span> <span class="pill green">Audit aktiv</span></div>';
    } else if(section==="players"){
      const {data,error}=await db.from("profiles").select("id,username,display_name,verified,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;
      const rows=(data??[]).map(p=>'<tr><td><strong>'+esc(p.username)+badge(p.verified)+'</strong></td><td>'+esc(p.display_name||"")+'</td><td>'+dateTime(p.created_at)+'</td><td><button class="btn small danger" data-player-action="ban" data-user="'+p.id+'">Bannen</button> <button class="btn small secondary" data-player-action="mute" data-user="'+p.id+'">Muten</button> <button class="btn small ghost" data-player-action="password" data-user="'+p.id+'">Passwort reset</button></td></tr>').join("");
      node.innerHTML='<div class="card"><h2>Spieler verwalten</h2><div class="table-wrap"><table><thead><tr><th>Username</th><th>Anzeigename</th><th>Erstellt</th><th>Aktionen</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    } else if(section==="bans"){
      const {data,error}=await db.from("bans").select("id,user_id,reason,starts_at,expires_at,profiles(username)").eq("active",true).order("starts_at",{ascending:false}).limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Aktive Sperren</h2><div class="list">'+((data??[]).map(b=>'<article class="list-item"><div class="item-head"><strong>'+esc(b.profiles?.username||b.user_id)+'</strong><span class="pill red">GESPERRT</span></div><p>'+esc(b.reason)+'</p><div class="inline-meta">Seit '+dateTime(b.starts_at)+' · Ende: '+(b.expires_at?dateTime(b.expires_at):"Unbefristet")+'</div><div class="action-group"><button class="btn small secondary" data-unban="'+b.user_id+'">Entbannen</button></div></article>').join("")||empty("Keine aktiven Sperren."))+'</div></div>';
    } else if(section==="verifications"){
      const {data,error}=await db.from("verification_requests").select("id,user_id,minecraft_name,status,requested_at,profiles(username)").eq("status","pending").order("requested_at");if(error)throw error;
      node.innerHTML='<div class="card"><h2>Offene Minecraft-Verifizierungen</h2><div class="list">'+((data??[]).map(v=>'<article class="list-item"><div class="item-head"><strong>'+esc(v.profiles?.username||v.user_id)+'</strong><span class="pill red">pending</span></div><p>Minecraft: <strong>'+esc(v.minecraft_name)+'</strong></p><div class="inline-meta">'+dateTime(v.requested_at)+'</div><div class="action-group"><button class="btn small" data-verify="yes" data-id="'+v.id+'">Verifizieren</button><button class="btn small danger" data-verify="no" data-id="'+v.id+'">Ablehnen</button></div></article>').join("")||empty("Keine offenen Anträge."))+'</div></div>';
    } else if(section==="applications"){
      const {data,error}=await db.from("applications").select("id,user_id,desired_role,reason,experience,status,created_at,profiles(username)").order("created_at",{ascending:false}).limit(50);if(error)throw error;
      const appMsgResults=await Promise.all((data??[]).map(async a=>{
        const {data:messages,error:messageError}=await db.rpc("application_message_history",{p_application_id:a.id});
        if(messageError)throw messageError;return (messages??[]).map(m=>({...m,application_id:a.id}));
      }));
      const appMessages=appMsgResults.flat();
      node.innerHTML='<div class="card"><h2>Team-Bewerbungen</h2><div class="list">'+((data??[]).map(a=>{
        const history=appMessages.filter(m=>m.application_id===a.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.profiles?.username||"Player")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
        return '<article class="list-item"><div class="item-head"><strong>'+esc(a.profiles?.username||"Player")+' · '+esc(a.desired_role)+'</strong><span class="pill">'+esc(a.status)+'</span></div><p>'+esc(a.reason)+'</p><div class="inline-meta">'+esc(a.experience||"Keine Erfahrung angegeben")+' · '+dateTime(a.created_at)+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch kein Nachrichtenverlauf.</div>')+'</div><form class="chat-compose" data-admin-app-message="'+a.id+'"><input class="input" name="message" maxlength="2000" placeholder="Private Nachricht an Bewerber …" required><button class="btn small">Senden</button></form><div class="action-group"><button class="btn small" data-application-status="accepted" data-id="'+a.id+'">Annehmen + Rang</button><button class="btn small danger" data-application-status="rejected" data-id="'+a.id+'">Ablehnen</button><button class="btn small ghost" data-application-status="reviewing" data-id="'+a.id+'">In Prüfung</button></div></article>';
      }).join("")||empty("Keine Bewerbungen vorhanden."))+'</div></div>';
    } else if(section==="building"){
      const {data,error}=await db.from("building_orders").select("id,user_id,title,description,budget,status,created_at,profiles(username)").order("created_at",{ascending:false}).limit(50);if(error)throw error;
      const orderMsgResults=await Promise.all((data??[]).map(async o=>{
        const {data:messages,error:messageError}=await db.rpc("building_message_history",{p_order_id:o.id});
        if(messageError)throw messageError;return (messages??[]).map(m=>({...m,order_id:o.id}));
      }));
      const orderMessages=orderMsgResults.flat();
      node.innerHTML='<div class="card"><h2>Building-Aufträge</h2><div class="list">'+((data??[]).map(o=>{
        const history=orderMessages.filter(m=>m.order_id===o.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.profiles?.username||"Player")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
        return '<article class="list-item"><div class="item-head"><strong>'+esc(o.title)+'</strong><span class="pill">'+esc(o.status)+'</span></div><p>'+esc(o.description)+'</p><div class="inline-meta">Von '+esc(o.profiles?.username||"Player")+' · Budget '+(o.budget===null?"offen":number(o.budget)+" ◆")+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch kein Nachrichtenverlauf.</div>')+'</div><form class="chat-compose" data-admin-building-message="'+o.id+'"><input class="input" name="message" maxlength="2000" placeholder="Private Nachricht an Spieler …" required><button class="btn small">Senden</button></form><div class="action-group">'+["reviewing","accepted","in_progress","completed","rejected"].map(s=>'<button class="btn small '+(s==="rejected"?"danger":"secondary")+'" data-building-status="'+s+'" data-id="'+o.id+'">'+s+'</button>').join("")+'</div></article>';
      }).join("")||empty("Keine Building-Aufträge."))+'</div></div>';
    } else if(section==="market"){
      const {data,error}=await db.from("market_items").select("id,symbol,name,active").order("symbol");if(error)throw error;
      node.innerHTML='<div class="card"><h2>Virtuelle Market-Preise</h2><div class="list">'+((data??[]).map(item=>'<form class="list-item market-admin-form" data-item="'+item.id+'"><div class="item-head"><strong>'+esc(item.name)+' · '+esc(item.symbol)+'</strong><span class="pill">'+(item.active?"aktiv":"inaktiv")+'</span></div><div class="form-grid"><div class="field"><label>Neuer Preis in ◆</label><input class="input" name="price" type="number" min="0" step="1" required></div><div class="field"><label>Änderungsgrund</label><input class="input" name="reason" maxlength="200" placeholder="Marktanpassung"></div></div><button class="btn small">Preis speichern</button></form>').join("")||empty("Keine Assets angelegt."))+'</div></div>';
    } else if(section==="chat"){
      const [reportResult,messageResult]=await Promise.all([
        db.from("chat_reports").select("id,message_id,reporter_user_id,reason,status,created_at").order("created_at",{ascending:false}).limit(50),
        db.from("chat_messages").select("id,user_id,message,created_at,profiles(username)").is("deleted_at",null).order("created_at",{ascending:false}).limit(40)
      ]);
      if(reportResult.error)throw reportResult.error;if(messageResult.error)throw messageResult.error;
      const reportCards=(reportResult.data??[]).map(r=>'<article class="list-item"><div class="item-head"><strong>Report #'+r.id+'</strong><span class="pill">'+esc(r.status)+'</span></div><p>'+esc(r.reason)+'</p><div class="inline-meta">Message #'+esc(r.message_id)+' · '+dateTime(r.created_at)+'</div><div class="action-group"><button class="btn small secondary" data-report-status="resolved" data-id="'+r.id+'">Erledigt</button><button class="btn small danger" data-delete-message="'+r.message_id+'">Nachricht löschen</button><button class="btn small ghost" data-report-status="dismissed" data-id="'+r.id+'">Dismiss</button></div></article>').join("");
      const messageCards=(messageResult.data??[]).map(m=>'<article class="list-item"><div class="item-head"><strong>'+esc(m.profiles?.username||m.user_id)+'</strong><span class="inline-meta">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p><div class="action-group"><button class="btn small danger" data-delete-message="'+m.id+'">Nachricht löschen</button></div></article>').join("");
      node.innerHTML='<div class="grid two"><div class="card"><h2>Offene Meldungen</h2><div class="list">'+(reportCards||empty("Keine Reports vorhanden."))+'</div></div><div class="card"><h2>Letzte Chat-Nachrichten</h2><div class="list">'+(messageCards||empty("Noch keine Nachrichten."))+'</div></div></div>';
    } else if(section==="roles"){
      const {data:users,error}=await db.from("profiles").select("id,username").order("username").limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Rolle zuweisen</h2><form id="role-form" class="form-grid"><div class="field"><label>Spieler</label><select name="user_id">'+(users??[]).map(u=>'<option value="'+u.id+'">'+esc(u.username)+'</option>').join("")+'</select></div><div class="field"><label>Rolle</label><select name="role">'+["user","verified","helper","moderator","media","admin"].map(r=>'<option value="'+r+'">'+r+'</option>').join("")+'</select></div><button class="btn">Rolle zuweisen</button></form><p class="form-note">Rollen werden zusätzlich serverseitig durch Permissions kontrolliert.</p></div>';
    } else if(section==="audit"){
      const {data,error}=await db.from("audit_logs").select("id,actor_user_id,action,target_user_id,metadata,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Audit Logs</h2><div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Aktion</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>'+((data??[]).map(a=>'<tr><td>'+dateTime(a.created_at)+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.actor_user_id)+'</td><td>'+esc(a.target_user_id)+'</td><td>'+esc(JSON.stringify(a.metadata))+'</td></tr>').join("")||'<tr><td colspan="5">Noch keine Aktionen.</td></tr>')+'</tbody></table></div></div>';
    } else if(section==="maintenance"){
      const {data,error}=await db.from("maintenance_windows").select("*").eq("id",1).single();if(error)throw error;
      node.innerHTML='<div class="card"><h2>Website Maintenance</h2><p class="muted">Bei aktivierter Wartung sehen normale Besucher eine Wartungsseite. Admins können die Seite weiterhin verwalten.</p><form id="maintenance-form" class="form"><label class="item-head"><span>Wartungsmodus</span><input type="checkbox" name="enabled" '+(data.enabled?"checked":"")+'></label><div class="field"><label>Nachricht</label><input class="input" name="message" value="'+esc(data.message)+'"></div><button class="btn">Einstellung speichern</button></form></div>';
    } else if(section==="console"){
      node.innerHTML='<div class="card"><h2>Safe Admin Console</h2><p class="muted">Nur freigegebene Website-Befehle. Keine Shell, keine SQL-Konsole.</p><form id="console-form" class="chat-compose"><input class="input" name="command" placeholder="/ban Spieler Regelverstoß" required><button class="btn">Ausführen</button></form><div class="form-note" style="margin-top:12px">Befehle: /ban, /unban, /mute, /unmute, /maintenance on|off, /announce Titel|Nachricht</div><div class="notice" id="console-output" style="margin-top:12px">Warte auf Befehl.</div></div>';
    }
  } catch(error) {
    node.innerHTML='<div class="notice error">Bereich konnte nicht geladen werden: '+esc(error.message)+'</div>';
  }
  wireAdminSection(section);
}
function wireAdminSection(section) {
  const node=$("admin-content");if(!node)return;
  node.onclick=async(event)=>{
    const button=event.target.closest("button");if(!button)return;
    try {
      if(button.dataset.playerAction){
        const id=button.dataset.user;
        if(button.dataset.playerAction==="ban"){
          const reason=prompt("Banngrund?","Regelverstoß");if(reason===null)return;
          await callAdmin("ban",{user_id:id,reason});
        }else if(button.dataset.playerAction==="mute"){
          const reason=prompt("Mute-Grund?","Moderation");if(reason===null)return;
          await callAdmin("mute",{user_id:id,reason});
        }else if(button.dataset.playerAction==="password"){
          const newPassword=prompt("Neues Passwort (min. 12 Zeichen mit Groß-/Kleinbuchstaben, Zahl und Sonderzeichen):");if(!newPassword)return;
          await authFunction({action:"admin_reset_password",user_id:id,new_password:newPassword});
        }
        toast("Spieler-Aktion abgeschlossen.","success");await loadAdminSection(section);
      }
      if(button.dataset.unban){
        if(!confirm("Diesen Spieler wirklich entbannen?"))return;
        await callAdmin("unban",{user_id:button.dataset.unban});
        toast("Spieler wurde entbannt.","success");await loadAdminSection(section);
      }
      if(button.dataset.verify){
        await callAdmin("verify",{request_id:Number(button.dataset.id),approve:button.dataset.verify==="yes",note:"Reviewed by staff"});
        toast("Verifizierungsantrag bearbeitet.","success");await loadAdminSection(section);
      }
      if(button.dataset.applicationStatus){
        await callAdmin("review_application",{application_id:Number(button.dataset.id),status:button.dataset.applicationStatus});
        toast("Bewerbung aktualisiert.","success");await loadAdminSection(section);
      }
      if(button.dataset.buildingStatus){
        await callAdmin("building_status",{order_id:Number(button.dataset.id),status:button.dataset.buildingStatus});
        toast("Auftragsstatus aktualisiert.","success");await loadAdminSection(section);
      }
      if(button.dataset.reportStatus){
        await callAdmin("report_status",{report_id:Number(button.dataset.id),status:button.dataset.reportStatus});
        toast("Report aktualisiert.","success");await loadAdminSection(section);
      }
      if(button.dataset.deleteMessage){
        if(!confirm("Chat-Nachricht wirklich ausblenden?"))return;
        await callAdmin("delete_chat_message",{message_id:Number(button.dataset.deleteMessage)});
        toast("Nachricht entfernt.","success");await loadAdminSection(section);
      }
    } catch(error){toast(error.message,"error");}
  };
  node.querySelectorAll("[data-admin-app-message]").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();const message=new FormData(form).get("message");const applicationId=Number(form.dataset.adminAppMessage);
    const {error}=await db.from("application_messages").insert({application_id:applicationId,user_id:currentUser.id,message:String(message||"").trim()});
    if(error)toast(error.message,"error");else{form.reset();toast("Private Bewerber-Nachricht gesendet.","success");await loadAdminSection(section);}
  });
  node.querySelectorAll("[data-admin-building-message]").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();const message=new FormData(form).get("message");const orderId=Number(form.dataset.adminBuildingMessage);
    const {error}=await db.from("building_messages").insert({order_id:orderId,user_id:currentUser.id,message:String(message||"").trim()});
    if(error)toast(error.message,"error");else{form.reset();toast("Private Building-Nachricht gesendet.","success");await loadAdminSection(section);}
  });
  node.querySelectorAll(".market-admin-form").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();const f=new FormData(form);try{await callAdmin("market_price",{item_id:form.dataset.item,price:Number(f.get("price")),reason:String(f.get("reason")||"")});toast("Preis aktualisiert.","success");form.reset();}catch(error){toast(error.message,"error");}
  });
  $("role-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await callAdmin("set_role",{user_id:String(f.get("user_id")),role:String(f.get("role"))});toast("Rolle zugewiesen.","success");}catch(error){toast(error.message,"error");}
  });
  $("maintenance-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await callAdmin("maintenance",{enabled:e.currentTarget.elements.enabled.checked,message:String(f.get("message")||"")});toast("Maintenance-Einstellung gespeichert.","success");}catch(error){toast(error.message,"error");}
  });
  $("console-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const command=String(new FormData(e.currentTarget).get("command")||"").trim();
    const out=$("console-output");
    try{
      const parts=command.split(" ");const verb=(parts.shift()||"").toLowerCase();const arg=parts.join(" ");
      if(verb==="/maintenance" && ["on","off"].includes(arg.toLowerCase())){
        await callAdmin("maintenance",{enabled:arg.toLowerCase()==="on",message:"KRAKE SMP wird gewartet."});out.textContent="Maintenance: "+arg;return;
      }
      if(verb==="/announce" && command.includes("|")){
        const payload=command.slice(command.indexOf(" ")+1).split("|");
        await callAdmin("announce",{title:payload.shift().trim(),message:payload.join("|").trim()});out.textContent="Announcement veröffentlicht.";return;
      }
      if(["/ban","/unban","/mute","/unmute"].includes(verb) && parts.length>=1){
        const username=parts[0].toLowerCase();const reason=parts.slice(1).join(" ")||"Admin Console";
        const {data:user,error}=await db.from("profiles").select("id,username").eq("username",username).maybeSingle();if(error)throw error;if(!user)throw new Error("Spieler nicht gefunden.");
        const map={"/ban":"ban","/unban":"unban","/mute":"mute","/unmute":"unmute"};
        await callAdmin(map[verb],{user_id:user.id,reason});out.textContent=verb+" ausgeführt für "+user.username;return;
      }
      throw new Error("Befehl nicht erlaubt oder Format falsch.");
    }catch(error){out.textContent=error.message;}
  });
}

async function checkMaintenance() {
  const {data,error}=await db.from("maintenance_windows").select("enabled,message,starts_at,ends_at").eq("id",1).maybeSingle();
  if(error||!data?.enabled)return;
  if(data.starts_at && new Date(data.starts_at)>new Date())return;
  if(data.ends_at && new Date(data.ends_at)<new Date())return;
  if(isAdmin())return;
  root.insertAdjacentHTML("beforeend",'<div class="maintenance-screen"><div class="eyebrow">KRAKE SMP</div><h1>Wartungsarbeiten</h1><p class="muted">'+esc(data.message)+'</p></div>');
}

async function render() {
  try {
    await refreshAuth();
    await renderPage();
    await checkMaintenance();
  } catch(error) {
    console.error(error);
    shell('<section class="card"><h2>Startfehler</h2><p class="muted">'+esc(error.message)+'</p></section>');
  }
}
window.addEventListener("hashchange",()=>renderPage());
window.addEventListener("load",()=>render());
