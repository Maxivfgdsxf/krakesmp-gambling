"use strict";

const CFG = window.KRAKE_CONFIG || { supabaseUrl: "", publishableKey: "", authFunction: "krake-auth" };
const supabaseLib = window.supabase;
const db = supabaseLib?.createClient ? supabaseLib.createClient(CFG.supabaseUrl, CFG.publishableKey, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
function requireDb(){ if(!db) throw new Error("Die Datenbank-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden."); return db; }
const root = document.getElementById("app");
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const number = (value) => Number(value ?? 0).toLocaleString("de-DE");
const compactPrice = (value) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const fmt = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/,"");
  if (abs >= 1000000000) return fmt(n/1000000000) + "b";
  if (abs >= 1000000) return fmt(n/1000000) + "m";
  if (abs >= 1000) return fmt(n/1000) + "k";
  return number(n);
};
const parsePrice = (value) => {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s/g,"").replace(",",".");
  const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/);
  if (!m) return NaN;
  const mult = m[2]==="b" ? 1000000000 : m[2]==="m" ? 1000000 : m[2]==="k" ? 1000 : 1;
  return Math.round(Number(m[1]) * mult);
};
const adminMark = () => isAdmin() ? '<span class="admin-aura" aria-label="Admin" title="Admin"><i></i></span>' : "";
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
let currentRoles = [];
let currentRoute = "home";
let activeChatChannel = null;
let chatPollTimer = null;
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
function openDrawer() {
  $("drawer")?.classList.add("open");
  $("kraken-menu")?.setAttribute("aria-expanded","true");
}
function closeDrawer() {
  $("drawer")?.classList.remove("open");
  $("kraken-menu")?.setAttribute("aria-expanded","false");
}
function isAdmin() { return currentUser?.id === "cee3680c-3580-47c5-8c64-0277eac03800" || permissions.includes("users.view") || permissions.includes("roles.manage"); }
function roleBadge(roleName){const map={admin:"ADMIN",moderator:"MOD",helper:"HELPER",media:"MEDIA",verified:"VERIFIED"};const key=String(roleName||"").toLowerCase();return map[key]?'<span class="role-aura role-'+key+'" title="'+map[key]+'"><i></i></span>':"";}
function roleBadges(roles){return (roles||[]).map(r=>roleBadge(r?.name||r)).join("");}
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
    // Read the JSON response body before showing Supabase's generic HTTP error.
    const response = error.context;
    if (response && typeof response.clone === "function") {
      try {
        const raw = await response.clone().text();
        let body = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        if (body?.error) throw new Error(String(body.error));
      } catch (readError) {
        if (readError instanceof Error && readError.message !== error.message) throw readError;
      }
    }
    throw new Error(error.message || "Authentifizierung fehlgeschlagen.");
  }
  if (data?.error) throw new Error(String(data.error));
  if (!data?.ok) throw new Error("Die Authentifizierung konnte nicht abgeschlossen werden.");
  return data;
}
async function refreshAuth() {
  const { data:{session} } = await db.auth.getSession();
  currentUser = null; profile = null; permissions = []; currentRoles = [];
  if (!session) return;
  const { data:{user},error:userError } = await db.auth.getUser();
  if (userError || !user) return;
  currentUser = user;
  const [{data:profileData,error:profileError},{data:permissionData},{data:roleData}] = await Promise.all([
    db.from("profiles").select("id,username,display_name,avatar_url,verified,created_at").eq("id",user.id).maybeSingle(),
    db.rpc("my_permissions"),
    db.from("user_roles").select("roles(name,display_name,priority)").eq("user_id",user.id)
  ]);
  if (profileError) throw profileError;
  profile = profileData;
  permissions = permissionData ?? [];
  currentRoles = (roleData ?? []).map(r=>r.roles).filter(Boolean);
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
  const nav = NAV.filter(([route])=>!["admin","market-tickets"].includes(route)).map(([route,icon,label,group]) =>
    '<button class="nav-link '+(currentRoute===route?'active':'')+'" data-route="'+route+'"><span class="nav-icon">'+icon+'</span>'+label+'</button>'
  ).join("");
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#home" aria-label="KRAKE SMP Startseite"><span class="brand-logo house-brand" aria-hidden="true"><svg class="house-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 30 32 9l24 21v24H38V40H26v14H8Z" fill="none" stroke="#ff5365" stroke-width="5" stroke-linejoin="round"/><path d="M23 29h18M26 36h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg></span><span class="brand-word">KRAKE <span class="brand-smp">SMP</span></span></a>
      <button type="button" class="kraken-menu-btn" id="kraken-menu" aria-label="KRAKE Navigation öffnen" aria-controls="drawer" aria-expanded="false" title="KRAKE Navigation">${KRAKEN_CREST}</button>
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
          ${isAdmin()?'<div class="nav-label">Administration</div><button class="nav-link '+(currentRoute==="admin"?'active':'')+'" data-route="admin"><span class="nav-icon">✦</span>Admin Panel</button><button class="nav-link '+(currentRoute==="market-tickets"?'active':'')+'" data-route="market-tickets"><span class="nav-icon">🎫</span>Market Tickets</button>':""}
          <button class="nav-link" id="auth-nav"><span class="nav-icon">${currentUser?"↪":"→"}</span>${currentUser?"Abmelden":"Anmelden"}</button>
        </nav>
      </aside>
    </div>
    <main class="page-wrap" id="page-content">${content}</main>
    <footer class="site-footer">KRAKE SMP · COMMUNITY PORTAL · <a href="#impressum">Impressum</a> · Made by Dev Mundi</footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;
  const krakenMenu = $("kraken-menu");
  const drawer = $("drawer");
  const menuClose = $("menu-close");
  const drawerBack = $("drawer-back");
  const setDrawerOpen = (open) => {
    if (!drawer) return;
    drawer.classList.toggle("open", Boolean(open));
    if (krakenMenu) krakenMenu.setAttribute("aria-expanded", String(Boolean(open)));
  };
  if (krakenMenu && drawer) {
    krakenMenu.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDrawerOpen(!drawer.classList.contains("open"));
    });
  }
  if (menuClose) menuClose.addEventListener("click", () => setDrawerOpen(false));
  if (drawerBack) drawerBack.addEventListener("click", () => setDrawerOpen(false));
  
  $("site-search")?.addEventListener("keydown",event=>{
    if(event.key!=="Enter")return;
    const q=event.currentTarget.value.toLowerCase();
    const route=q.includes("chat")?"chat":q.includes("minigame")||q.includes("spiel")?"minigames":
      q.includes("markt")||q.includes("market")||q.includes("item")?"market":
      q.includes("event")?"events":q.includes("rang")||q.includes("leader")?"leaderboards":
      q.includes("einstellung")||q.includes("minecraft")?"settings":
      q.includes("profil")||q.includes("spieler")?"leaderboards":"";
    if(route)go(route);else toast("Kein passender Bereich gefunden.");
  });
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
  const [events,announcements,leaders,chats,marketItems] = await Promise.all([
    db.from("events").select("name,description,starts_at,ends_at").eq("active",true).limit(1),
    db.from("announcements").select("title,message,created_at").eq("active",true).order("created_at",{ascending:false}).limit(2),
    db.from("player_statistics").select("user_id,rating,wins,games_played,total_score,profiles(username,display_name,verified)").order("rating",{ascending:false}).limit(3),
    db.from("chat_messages").select("id,user_id,message,created_at,profiles(username,display_name,verified)").is("deleted_at",null).order("created_at",{ascending:false}).limit(3),
    db.from("market_items").select("id,symbol,name").eq("active",true).order("symbol").limit(3),
  ]);
  for (const result of [events,announcements,leaders,chats,marketItems]) {
    if(result?.error) console.warn("Home section:",result.error.message);
  }
  const event=events.data?.[0];
  const hello=profile?.display_name||profile?.username||"Spieler";
  const announcementHtml=(announcements.data??[]).map(a=>'<article class="list-item"><div class="item-title">'+esc(a.title)+'</div><p>'+esc(a.message)+'</p><div class="inline-meta">'+dateTime(a.created_at)+'</div></article>').join("");
  const leaderHtml=(leaders.data??[]).map((p,i)=>'<div class="leader-row"><span class="leader-rank">'+(i+1)+'</span><span class="leader-avatar">♟</span><strong>'+esc(p.profiles?.display_name||p.profiles?.username||"Player")+'</strong><span>'+number(p.rating)+' RP</span></div>').join("");
  const chatHtml=(chats.data??[]).map(m=>'<div class="home-chat-row"><strong>'+esc(m.profiles?.display_name||m.profiles?.username||"Player")+'</strong><span>'+dateTime(m.created_at)+'</span><p>'+esc(m.message)+'</p></div>').join("");
  const marketHtml=(marketItems.data??[]).map(m=>'<div class="market-mini-row"><span class="market-mini-icon">◆</span><div><strong>'+esc(m.name)+'</strong><small>'+esc(m.symbol)+'</small></div></div>').join("");
  return `
    <section class="home-hero">
      <div class="hero-copy">
        <div class="hero-welcome">Willkommen auf</div>
        <h1><span class="red-word">KRAKE</span> <span class="metal-word">SMP</span></h1>
        <p class="home-tagline">Deine Community. Dein <strong>SMP.</strong> Deine Welt.</p>
        <p class="home-description">Ein Ort für deine Crew: Community-Chat, Minigames, Rankings, Events und Services – alles vereint in deinem KRAKE SMP Portal.</p>
        <div class="action-row">
          <button class="btn" data-route="chat">Community öffnen <span>→</span></button>
          <button class="btn secondary" data-route="leaderboards">Rankings ansehen</button>
        </div>
        ${currentUser?'<p class="muted home-greeting">Willkommen zurück, <strong>'+esc(hello)+'</strong>.'+'</p>':'<p class="muted home-greeting">Melde dich an und werde Teil der Community.</p>'}
      </div>
      <div class="hero-crest-panel">
        <div class="hero-crest-glow"></div>
        ${KRAKEN_CREST}
        <div class="hero-crest-caption"><span class="status-dot"></span> KRAKE COMMUNITY HUB</div>
      </div>
      <div class="hero-quick-stats">
        <a href="#chat"><span class="quick-stat-icon">◉</span><strong>Community Chat</strong><small>Live-Unterhaltungen</small></a>
        <a href="#minigames"><span class="quick-stat-icon">⚔</span><strong>Minigames</strong><small>Skill & Challenges</small></a>
        <a href="#leaderboards"><span class="quick-stat-icon">♛</span><strong>Leaderboard</strong><small>Spieler-Rankings</small></a>
        
      </div>
    </section>
    <section class="home-dashboard-grid">
      <article class="card home-leader-card">
        <div class="home-card-head"><div><span class="eyebrow">COMPETITIVE</span><h2>Top 3 Leaderboard</h2></div><a href="#leaderboards">Alle ansehen →</a></div>
        <div class="leader-list">${leaderHtml||empty("Noch keine Spieler-Rankings vorhanden.")}</div>
      </article>
      <article class="card home-event-card">
        <div class="home-card-head"><div><span class="eyebrow">SEASONAL</span><h2>Event</h2></div><a href="#events">Alle Events →</a></div>
        <div class="event-visual"><div class="event-sigil">✦</div><span class="pill ${event?"red":""}">${event?"AKTIV":"YEAR ROUND"}</span></div>
        <h3>${esc(event?.name||"KRAKE Community")}</h3>
        <p>${esc(event?.description||"Hier erscheinen die nächsten Community-Events und SMP-Specials.")}</p>
        <button class="btn secondary small" data-route="events">Mehr erfahren →</button>
      </article>
      <article class="card home-chat-card">
        <div class="home-card-head"><div><span class="eyebrow">COMMUNITY</span><h2>Community Chat</h2></div><a href="#chat">Öffnen →</a></div>
        <div class="home-chat-list">${chatHtml||empty("Noch keine Nachrichten im Chat.")}</div>
        <button class="btn small" data-route="chat">Zum Chat senden</button>
      </article>
      <article class="card home-market-card">
        <div class="home-card-head"><div><span class="eyebrow">VIRTUAL ECONOMY</span><h2>Krake Market</h2></div><a href="#market">Zum Market →</a></div>
        <div class="market-mini-list">${marketHtml||empty("Noch keine Market-Assets vorhanden.")}</div>
      </article>
      <article class="card home-news-card">
        <div class="home-card-head"><div><span class="eyebrow">UPDATES</span><h2>Community News</h2></div></div>
        <div class="list">${announcementHtml||empty("Noch keine Neuigkeiten veröffentlicht.")}</div>
      </article>
    </section>
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

function chatMessageMarkup(m) {
  const name=m.profiles?.display_name||m.profiles?.username||"Player";
  const report=currentUser&&currentUser.id!==m.user_id?'<button type="button" class="btn ghost small" data-report="'+m.id+'">Melden</button>':"";
  const moderation=isAdmin()?'<button type="button" class="btn ghost small danger" data-chat-delete="'+m.id+'">Löschen</button><button type="button" class="btn ghost small" data-chat-mute="'+m.user_id+'">Timeout</button><button type="button" class="btn ghost small danger" data-chat-ban="'+m.user_id+'">Sperren</button>':"";
  return '<article class="chat-message" data-message-id="'+m.id+'"><div class="chat-message-head"><span class="who">'+esc(name)+roleBadges(m.profiles?.roles)+badge(m.profiles?.verified)+'</span><span class="when">'+dateTime(m.created_at)+'</span><div class="chat-actions">'+report+moderation+'</div></div><p>'+esc(m.message)+'</p></article>';
}
async function renderChat() {
  const {data:chatSetting,error:settingError}=await db.from("chat_settings").select("mode,slow_seconds").eq("id",1).maybeSingle();
  if(settingError)console.warn("Chat settings unavailable:",settingError.message);
  const messages=await db.from("chat_messages").select("id,user_id,message,created_at").is("deleted_at",null).order("created_at",{ascending:false}).limit(100);
  if(messages.error)throw messages.error;
  const rows=(messages.data??[]).reverse();
  const ids=[...new Set(rows.map(m=>m.user_id).filter(Boolean))];
  let profilesById=new Map();
  if(ids.length){
    const {data:profilesData,error:profilesError}=await db.from("profiles").select("id,username,display_name,verified").in("id",ids);
    const {data:roleRows,error:roleError}=await db.from("user_roles").select("user_id,roles(name,display_name,priority)").in("user_id",ids);
    if(profilesError)throw profilesError;
    if(roleError)console.warn("Chat role lookup failed:",roleError.message);
    const rolesById=new Map();
    (roleRows??[]).forEach(r=>{if(!rolesById.has(r.user_id))rolesById.set(r.user_id,[]);if(r.roles)rolesById.get(r.user_id).push(r.roles);});
    profilesById=new Map((profilesData??[]).map(p=>[p.id,{...p,roles:rolesById.get(p.id)||[]}]));
  }
  lastChatMessages=rows.map(m=>({...m,profiles:profilesById.get(m.user_id)||null}));
  const items=lastChatMessages.map(chatMessageMarkup).join("");
  const mode=chatSetting?.mode||"normal";
  const modeLabel=mode==="admin"?"Nur Admins":mode==="media"?"Media-Modus":mode==="slow"?"Slow Mode":"Normal";
  const modeNotice='<div class="notice chat-mode-notice"><strong>Chat-Modus: '+modeLabel+'</strong>'+(mode==="slow"?' · '+number(chatSetting?.slow_seconds||5)+' Sekunden zwischen deinen Nachrichten':"")+'</div>';
  return pageHead("COMMUNITY","Globaler Chat","Schreib mit der KRAKE Community. Chat-Regeln gelten für alle Mitglieder.")+
    modeNotice+'<section class="card"><div class="chat-window" id="chat-window">'+(items||empty("Noch keine Nachrichten. Starte die Unterhaltung!"))+'</div>'+
    (currentUser?'<form id="chat-form" class="chat-compose"><input class="input" id="chat-input" maxlength="2000" placeholder="Nachricht schreiben …" required><button class="btn" type="submit">Senden</button></form>':'<div class="notice" style="margin-top:12px">Zum Schreiben bitte <button class="btn small" data-route="login">anmelden</button>.</div>')+
    '<p class="form-note">Nachrichten werden moderiert. Melde problematische Inhalte über „Melden“.</p></section>';
}
async function loadChatMessages() {
  const {data,error}=await db.from("chat_messages").select("id,user_id,message,created_at").is("deleted_at",null).order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  const rows=(data??[]).reverse(),ids=[...new Set(rows.map(m=>m.user_id).filter(Boolean))];
  let profilesById=new Map();
  if(ids.length){
    const {data:profilesData,error:profilesError}=await db.from("profiles").select("id,username,display_name,verified").in("id",ids);
    if(profilesError)throw profilesError;
    const {data:roleRows,error:roleError}=await db.from("user_roles").select("user_id,roles(name,display_name,priority)").in("user_id",ids);
    if(roleError)console.warn("Chat role refresh failed:",roleError.message);
    const rolesById=new Map();
    (roleRows??[]).forEach(r=>{if(!rolesById.has(r.user_id))rolesById.set(r.user_id,[]);if(r.roles)rolesById.get(r.user_id).push(r.roles);});
    profilesById=new Map((profilesData??[]).map(p=>[p.id,{...p,roles:rolesById.get(p.id)||[]}]));
  }
  lastChatMessages=rows.map(m=>({...m,profiles:profilesById.get(m.user_id)||null}));
  const node=$("chat-window");if(!node)return;
  node.innerHTML=lastChatMessages.map(chatMessageMarkup).join("")||empty("Noch keine Nachrichten. Starte die Unterhaltung!");
  node.scrollTop=node.scrollHeight;
}


function showConfirm(title,message,confirmText="Bestätigen"){return new Promise(resolve=>{const old=$("krake-confirm");if(old)old.remove();const el=document.createElement("div");el.id="krake-confirm";el.className="krake-modal";el.innerHTML='<div class="krake-modal-backdrop"></div><div class="krake-modal-card confirm-modal"><button class="modal-close" type="button" data-confirm-no>×</button><div class="eyebrow">BESTÄTIGUNG</div><h2>'+esc(title)+'</h2><p class="muted">'+esc(message)+'</p><div class="action-row"><button class="btn danger" data-confirm-yes>'+esc(confirmText)+'</button><button class="btn secondary" data-confirm-no>Abbrechen</button></div></div>';document.body.appendChild(el);const done=v=>{el.remove();resolve(v);};el.querySelectorAll("[data-confirm-no]").forEach(b=>b.onclick=()=>done(false));el.querySelector("[data-confirm-yes]").onclick=()=>done(true);el.querySelector(".krake-modal-backdrop").onclick=()=>done(false);});}

function wireChat() {
  $("chat-form")?.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!currentUser){toast("Bitte zuerst anmelden.","error");return;}
    const input=$("chat-input"),message=input?.value.trim();
    if(!message)return;
    const submit=event.currentTarget.querySelector("button[type=submit]");
    if(submit)submit.disabled=true;
    try{
      const {error}=await db.from("chat_messages").insert({user_id:currentUser.id,message});
      if(error)throw error;
      input.value="";
      await loadChatMessages();
    }catch(error){
      console.error("Chat send failed",error);
      toast("Chat konnte nicht gesendet werden: "+(error.message||"Unbekannter Fehler"),"error");
    }finally{if(submit)submit.disabled=false;}
  });
  const chatWindow=$("chat-window");
  chatWindow?.addEventListener("click",async event=>{
    const mod=event.target.closest("[data-chat-delete],[data-chat-mute],[data-chat-ban]");
    if(mod&&isAdmin()){
      if(mod.disabled)return;
      try{
        if(mod.dataset.chatDelete){
          const messageId=Number(mod.dataset.chatDelete);
          if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("Ungültige Nachrichten-ID.");
          mod.disabled=true;
          await callAdmin("delete_chat_message",{message_id:messageId});
          await loadChatMessages();
          toast("Nachricht gelöscht.","success");
          return;
        }
        const uid=mod.dataset.chatMute||mod.dataset.chatBan;
        if(mod.dataset.chatMute){
          if(!await showConfirm("Timeout setzen?","Der Benutzer kann für die gewählte Zeit nicht schreiben.","Timeout setzen"))return;
          const hours=Number(prompt("Timeout in Stunden?","1"));
          if(!Number.isFinite(hours)||hours<=0)return;
          mod.disabled=true;
          await callAdmin("mute",{user_id:uid,reason:"Chat-Moderation",expires_at:new Date(Date.now()+hours*3600000).toISOString()});
          toast("Timeout gesetzt.","success");
          await loadChatMessages();
          return;
        }
        if(!await showConfirm("Benutzer sperren?","Der Benutzer wird für den Chat gesperrt.","Sperren"))return;
        mod.disabled=true;
        await callAdmin("ban",{user_id:uid,reason:"Chat-Moderation",expires_at:null});
        toast("Benutzer gesperrt.","success");
        await loadChatMessages();
        return;
      }catch(error){
        if(mod.isConnected)mod.disabled=false;
        toast(error.message||"Moderationsaktion fehlgeschlagen.","error");
        return;
      }
    }
    const button=event.target.closest("[data-report]");
    if(!button||!currentUser)return;
    const reason=prompt("Warum möchtest du diese Nachricht melden?");
    if(!reason)return;
    const {error}=await db.from("chat_reports").insert({message_id:Number(button.dataset.report),reporter_user_id:currentUser.id,reason});
    toast(error?error.message:"Nachricht wurde gemeldet.",error?"error":"success");
  });
  activeChatChannel=db.channel("krake-global-chat").on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages"},()=>loadChatMessages().catch(console.error)).subscribe((status)=>{
    if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")console.warn("Chat realtime:",status);
  });
  chatPollTimer=window.setInterval(()=>loadChatMessages().catch(console.error),5000);
}


function wireReaction() {
  const stage=$("game-stage"), area=$("game-area");
  if(!stage||!area)return;
  const names={reaction:"Reaction",speed:"Speed Challenge",duel:"Duel",memory:"Memory",aim:"Aim",quiz:"Quiz Duel",decision:"Quick Decision"};
  const save=async(slug,score,timeMs,won,metadata={})=>{
    const {data:game}=await db.from("minigames").select("id").eq("slug",slug).single();
    if(!game)return;
    const {error}=await db.from("minigame_results").insert({minigame_id:game.id,user_id:currentUser.id,score:Math.max(0,Math.round(score||0)),time_ms:timeMs??null,won:Boolean(won),metadata});
    if(error)toast("Ergebnis konnte nicht gespeichert werden: "+error.message,"error");
    else {
      toast("Ergebnis gespeichert!","success");
      window.setTimeout(()=>{
        if(!$("game-stage")||$("game-stage").hidden)return;
        $("game-area").innerHTML='<div class="game-center"><div class="muted">Bereit für die nächste Runde?</div><button class="btn" data-game-replay="'+esc(slug)+'">Nochmal spielen</button></div>';
        $("game-area").querySelector("[data-game-replay]")?.addEventListener("click",()=>open(slug));
      },1400);
    }
  };
  const open=(slug)=>{
    if(!currentUser){go("login");return;}
    stage.hidden=false;$("game-title").textContent=names[slug]||slug;$("game-description").textContent="Spiele jetzt und setze deine Bestmarke.";
    area.innerHTML="";
    if(slug==="reaction"){
      area.innerHTML='<div class="game-center"><div id="reaction-result" class="muted">Bereit?</div><button id="reaction-button" class="btn reaction-button">Challenge starten</button></div>';
      let state="idle",timer=null,start=0;
      $("reaction-button").onclick=async()=>{const b=$("reaction-button"),r=$("reaction-result");if(state==="idle"){state="waiting";b.textContent="Warte …";r.textContent="Nicht zu früh klicken!";timer=setTimeout(()=>{state="ready";start=performance.now();b.textContent="JETZT KLICKEN";b.className="btn reaction-button ready";r.textContent="LOS!";},1500+Math.random()*2200);}else if(state==="waiting"){clearTimeout(timer);state="idle";b.textContent="Nochmal";r.textContent="Fehlstart!";b.className="btn reaction-button early";}else{const ms=Math.round(performance.now()-start);state="idle";r.textContent=ms+" ms";b.textContent="Nochmal spielen";b.className="btn reaction-button";await save(slug,Math.max(0,1200-ms),ms,true,{type:"reaction"});}};
    } else if(slug==="speed"){
      area.innerHTML='<div class="game-center"><div id="speed-info" class="muted">Klicke 12-mal so schnell wie möglich.</div><button id="speed-btn" class="btn">Start</button></div>';let n=0,start=0;
      $("speed-btn").onclick=async()=>{if(n===0){n=1;start=performance.now();$("speed-btn").textContent="KLICK 1/12";return;}n++;if(n<=12)$("speed-btn").textContent="KLICK "+n+"/12";if(n>12){const ms=Math.round(performance.now()-start);$("speed-info").textContent="Zeit: "+ms+" ms";$("speed-btn").textContent="Nochmal";n=0;await save(slug,Math.max(0,15000-ms),ms,true,{clicks:12});}};
    } else if(slug==="memory"){
      const symbols=["☠","🪽","🍎","⚔","⛏","💎"],deck=[...symbols,...symbols].sort(()=>Math.random()-.5);area.innerHTML='<div class="memory-grid">'+deck.map((s,i)=>'<button class="memory-card" data-memory="'+i+'" data-value="'+s+'">?</button>').join("")+'</div><p id="memory-info" class="muted">Finde alle Paare.</p>';
      let first=null,lock=false,found=0,moves=0;document.querySelectorAll("[data-memory]").forEach(btn=>btn.onclick=async()=>{if(lock||btn.classList.contains("found"))return;btn.textContent=btn.dataset.value;if(first===null){first=btn;return;}moves++;if(first.dataset.value===btn.dataset.value){first.classList.add("found");btn.classList.add("found");found++;first=null;if(found===symbols.length){const score=Math.max(0,1200-moves*70);$("memory-info").textContent="Fertig! "+moves+" Züge.";await save(slug,score,null,true,{moves});}}else{lock=true;setTimeout(()=>{first.textContent="?";btn.textContent="?";first=null;lock=false;},500);}});
    } else if(slug==="aim"){
      area.innerHTML='<div class="aim-zone" id="aim-zone"><button id="aim-target">+</button></div><p id="aim-info" class="muted">Treffe 10 Ziele.</p>';let hits=0,start=performance.now(),target=$("aim-target");
      const place=()=>{target.style.left=(8+Math.random()*84)+"%";target.style.top=(8+Math.random()*78)+"%";};place();target.onclick=async()=>{hits++;if(hits>=10){const ms=Math.round(performance.now()-start);$("aim-info").textContent="Fertig! "+ms+" ms";await save(slug,Math.max(0,3000-ms),ms,true,{hits});}else{$("aim-info").textContent=hits+"/10";place();}};
    } else if(slug==="duel"){
      area.innerHTML='<div class="duel-grid"><button class="btn" data-duel="attack">⚔️ Angriff</button><button class="btn secondary" data-duel="defend">🛡️ Verteidigen</button><div id="duel-info" class="muted">Best of 5 gegen den KRAKE Bot.</div></div>';let p=0,b=0,round=0;
      document.querySelectorAll("[data-duel]").forEach(btn=>btn.onclick=async()=>{round++;const bot=["attack","defend"][Math.floor(Math.random()*2)],mine=btn.dataset.duel;if(mine!==bot)p++;else b++;$("duel-info").textContent="Runde "+round+" · Du "+p+" : "+b+" Bot";if(round>=5){const won=p>b;await save(slug,won?1000:300,p*1000,won,{player:p,bot:b});$("duel-info").textContent=won?"Du hast gewonnen!":"Der Bot gewinnt.";round=0;p=0;b=0;}});
    } else if(slug==="quiz"){
      const facts=[
        ["Wie viele Herzen hat ein Minecraft-Spieler?",["10","20","40"],1],["Welches Item wird für einen Beacon benötigt?",["Netherstern","Enderperle","Smaragd"],0],["In welcher Dimension lebt der Enderdrache?",["Nether","End","Overworld"],1],["Wie viele Holzplanken braucht ein Crafting Table?",["4","6","8"],0],["Welcher Mob explodiert?",["Creeper","Skeleton","Zombie"],0],["Wie viele Slots hat eine normale Kiste?",["27","36","54"],0],["Welches Erz wird für Diamantwerkzeuge benötigt?",["Diamanterz","Eisenerz","Kupfererz"],0],["Was braucht man für den Rahmen eines Netherportals?",["Obsidian","Bedrock","Basalt"],0],["Welches Tier kann man mit Weizen züchten?",["Kuh","Wolf","Katze"],0],["Was macht eine Elytra?",["Gleiten","Unsichtbar machen","Heilen"],0],["Welches Werkzeug baut Stein am besten ab?",["Spitzhacke","Schaufel","Axt"],0],["Was droppt ein Creeper typischerweise?",["Schwarzpulver","Faden","Knochen"],0],["Welche Dimension erreicht man durch ein Endportal?",["End","Nether","Overworld"],0],["Was braucht man als Basisstation zum Brauen?",["Braustand","Amboss","Ofen"],0],["Welcher Mob kann Dörfer angreifen?",["Plünderer","Kuh","Tintenfisch"],0],["Was kann man mit einem Amboss tun?",["Items reparieren und umbenennen","Wasser kochen","Portale öffnen"],0],["Was setzt ein Bett?",["Schlafpunkt","Spawn von Mobs","Zaubertisch"],0],["Welcher Block gehört zum Zaubertisch?",["Obsidian","Sandstein","Schnee"],0],["Welche Ressource ist typisch für Kupferblöcke?",["Kupfer","Gold","Quarz"],0],["Welcher Mob schießt Pfeile?",["Skelett","Schwein","Kuh"],0]
      ];
      const variants=["Welche Aussage trifft zu?","Wähle die richtige Antwort:","Was ist korrekt?","Kennst du die Antwort?","Welche Option stimmt?"];
      const pool=Array.from({length:50},(_,round)=>facts.map((f,idx)=>({q:(round?variants[round%variants.length]+" ":"")+f[0],o:f[1],a:f[2],key:round*facts.length+idx}))).flat();
      const startSelector=()=>{
        area.innerHTML='<div class="quiz-box quiz-selector"><div class="eyebrow">QUIZ MODUS</div><h2>Wähle deine Schwierigkeit</h2><p class="muted">Über 1.000 Fragen im KRAKE Quiz-Pool · eigene Buttons · neue Fragen bei jeder Runde.</p><div class="quiz-difficulty-buttons"><button class="btn quiz-level" data-level="easy">EASY</button><button class="btn quiz-level" data-level="middle">MIDDLE</button><button class="btn quiz-level" data-level="hard">SCHWER</button></div></div>';
        area.querySelectorAll("[data-level]").forEach(btn=>btn.onclick=()=>startQuiz(btn.dataset.level));
      };
      const startQuiz=(level)=>{
        const count=level==="easy"?10:level==="middle"?12:15;
        const selected=[...pool].sort(()=>Math.random()-.5).slice(0,count);
        let i=0,score=0,correct=0;
        const draw=()=>{
          const q=selected[i];
          area.innerHTML='<div class="quiz-box quiz-live"><div class="quiz-live-head"><span class="pill red">'+esc(level.toUpperCase())+'</span><span class="muted">'+(i+1)+' / '+selected.length+'</span></div><h3>'+esc(q.q)+'</h3><div class="quiz-options">'+q.o.map((a,j)=>'<button class="btn quiz-option" data-quiz="'+j+'">'+esc(a)+'</button>').join("")+'</div></div>';
          area.querySelectorAll("[data-quiz]").forEach(btn=>btn.onclick=async()=>{
            if(Number(btn.dataset.quiz)===q.a){correct++;score+=level==="easy"?100:level==="middle"?150:220;}
            i++;
            if(i<selected.length)draw();
            else{
              const won=correct>=Math.ceil(selected.length*.6);
              area.innerHTML='<div class="game-center quiz-result"><div class="eyebrow">QUIZ COMPLETE</div><h2>'+correct+' / '+selected.length+' richtig</h2><p>Score: '+score+' · '+(won?"Bestanden":"Noch nicht bestanden")+'</p><button class="btn" data-quiz-again>Andere Schwierigkeit</button></div>';
              await save(slug,score,null,won,{difficulty:level,correct,total:selected.length});
              area.querySelector("[data-quiz-again]")?.addEventListener("click",startSelector);
            }
          });
        };
        draw();
      };
      startSelector();
    } else if(slug==="decision"){
      let round=0,score=0;const draw=()=>{area.innerHTML='<div class="game-center"><h2>Quick Decision</h2><p>Wähle schnell.</p><div class="action-row"><button class="btn" data-decision="left">LINKS</button><button class="btn secondary" data-decision="right">RECHTS</button></div><p class="muted">Runde '+(round+1)+'/8</p></div>';document.querySelectorAll("[data-decision]").forEach(btn=>btn.onclick=async()=>{if(Math.random()>.5)score+=150;round++;if(round<8)draw();else{area.innerHTML='<div class="game-center"><h2>Fertig</h2><p>Score: '+score+'</p></div>';await save(slug,score,null,score>=600,{rounds:8});}})};draw();
    }
  };
  document.querySelectorAll("[data-game-start]").forEach(b=>b.onclick=()=>open(b.dataset.gameStart));
  $("game-close").onclick=()=>{stage.hidden=true;area.innerHTML="";};
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
      const [players,bans,verifications,applications,orders,reports,pendingResult]=await Promise.all([
        countRows("profiles"),countRows("bans"),countRows("verification_requests"),countRows("applications"),countRows("building_orders"),countRows("chat_reports"),
        db.from("verification_requests").select("id,user_id,minecraft_name,status,requested_at").eq("status","pending").order("requested_at",{ascending:false}).limit(5)
      ]);
      if(pendingResult.error)throw pendingResult.error;
      const verifyIds=[...new Set((pendingResult.data??[]).map(v=>v.user_id).filter(Boolean))];
      let verifyProfiles=new Map();
      if(verifyIds.length){const {data:vp}=await db.from("profiles").select("id,username,display_name").in("id",verifyIds);verifyProfiles=new Map((vp??[]).map(p=>[p.id,p]));}
      const pendingCards=(pendingResult.data??[]).map(v=>{const p=verifyProfiles.get(v.user_id);return '<article class="admin-request"><div><strong>'+esc(p?.display_name||p?.username||"Player")+'</strong><span class="pill red">PENDING</span></div><p>🎮 '+esc(v.minecraft_name)+'</p><small>'+dateTime(v.requested_at)+'</small><div class="action-group"><button class="btn small" data-verify="yes" data-id="'+v.id+'">✓ Annehmen</button><button class="btn small danger" data-verify="no" data-id="'+v.id+'">Ablehnen</button></div></article>';}).join("");
      node.innerHTML='<div class="grid four"><div class="card stat-card"><div class="stat-label">Spieler</div><div class="stat-number">'+players+'</div></div><div class="card stat-card"><div class="stat-label">Bans</div><div class="stat-number">'+bans+'</div></div><div class="card stat-card"><div class="stat-label">Verifizierungen</div><div class="stat-number">'+verifications+'</div></div><div class="card stat-card"><div class="stat-label">Reports</div><div class="stat-number">'+reports+'</div></div></div><div class="admin-overview-grid"><div class="card"><h2>Admin Control</h2><p class="muted">Serverseitige Aktionen, Audit Logs und Moderation.</p><span class="pill green">RLS aktiv</span> <span class="pill green">RBAC aktiv</span> <span class="pill green">Audit aktiv</span></div><div class="card verification-request-panel"><div class="item-head"><div><div class="eyebrow">QUICK ACTION</div><h2>Verifizierungs-Anfragen</h2></div><button class="btn small secondary" data-admin-tab="verifications">Alle öffnen</button></div><div class="admin-request-list">'+(pendingCards||'<div class="empty">Keine offenen Anfragen.</div>')+'</div></div></div>';
    } else if(section==="players"){
      const {data,error}=await db.from("profiles").select("id,username,display_name,verified,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;
      const rows=(data??[]).map(p=>'<tr><td><strong>'+esc(p.display_name||p.username)+badge(p.verified)+'</strong></td><td>'+esc(p.username)+'</td><td>'+dateTime(p.created_at)+'</td><td><button class="btn small danger" data-player-action="ban" data-user="'+p.id+'">Bannen</button> <button class="btn small secondary" data-player-action="mute" data-user="'+p.id+'">Muten</button> <button class="btn small ghost" data-player-action="password" data-user="'+p.id+'">Passwort reset</button></td></tr>').join("");
      node.innerHTML='<div class="card"><h2>Spieler verwalten</h2><div class="table-wrap"><table><thead><tr><th>Username</th><th>Anzeigename</th><th>Erstellt</th><th>Aktionen</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    } else if(section==="bans"){
      const {data,error}=await db.from("bans").select("id,user_id,reason,starts_at,expires_at,profiles(username)").eq("active",true).order("starts_at",{ascending:false}).limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Aktive Sperren</h2><div class="list">'+((data??[]).map(b=>'<article class="list-item"><div class="item-head"><strong>'+esc(b.profiles?.username||b.user_id)+'</strong><span class="pill red">GESPERRT</span></div><p>'+esc(b.reason)+'</p><div class="inline-meta">Seit '+dateTime(b.starts_at)+' · Ende: '+(b.expires_at?dateTime(b.expires_at):"Unbefristet")+'</div><div class="action-group"><button class="btn small secondary" data-unban="'+b.user_id+'">Entbannen</button></div></article>').join("")||empty("Keine aktiven Sperren."))+'</div></div>';
    } else if(section==="verifications"){
      const {data,error}=await db.from("verification_requests").select("id,user_id,minecraft_name,status,requested_at").eq("status","pending").order("requested_at");if(error)throw error;
      const verifyIds=[...new Set((data??[]).map(v=>v.user_id).filter(Boolean))];
      let verifyProfiles=new Map();
      if(verifyIds.length){const {data:profilesData,error:profilesError}=await db.from("profiles").select("id,username,display_name").in("id",verifyIds);if(profilesError)console.warn("Minecraft profiles:",profilesError.message);verifyProfiles=new Map((profilesData??[]).map(p=>[p.id,p]));}
      node.innerHTML='<div class="card"><h2>Offene Minecraft-Verifizierungen</h2><p class="muted">Minecraft-Anträge werden getrennt von Profil-Daten geladen, damit der Admin-Bereich auch bei fehlerhaften Beziehungen funktioniert.</p><div class="list">'+((data??[]).map(v=>{const p=verifyProfiles.get(v.user_id);return '<article class="list-item"><div class="item-head"><strong>'+esc(p?.display_name||p?.username||v.user_id)+'</strong><span class="pill red">pending</span></div><p>Minecraft: <strong>'+esc(v.minecraft_name)+'</strong></p><div class="inline-meta">'+dateTime(v.requested_at)+'</div><div class="action-group"><button class="btn small" data-verify="yes" data-id="'+v.id+'">Verifizieren</button><button class="btn small danger" data-verify="no" data-id="'+v.id+'">Ablehnen</button></div></article>';}).join("")||empty("Keine offenen Anträge."))+'</div></div>';
    } else if(section==="applications"){
      const {data,error}=await db.from("applications").select("id,user_id,desired_role,reason,experience,status,created_at,profiles(username)").order("created_at",{ascending:false}).limit(50);if(error)throw error;
      const appMsgResults=await Promise.all((data??[]).map(async a=>{
        const {data:messages,error:messageError}=await db.rpc("application_message_history",{p_application_id:a.id});
        if(messageError)throw messageError;return (messages??[]).map(m=>({...m,application_id:a.id}));
      }));
      const appMessages=appMsgResults.flat();
      node.innerHTML='<div class="card"><h2>Team-Bewerbungen</h2><div class="list">'+((data??[]).map(a=>{
        const history=appMessages.filter(m=>m.application_id===a.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.profiles?.display_name||m.profiles?.username||"Player")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
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
        const history=orderMessages.filter(m=>m.order_id===o.id).map(m=>'<div class="chat-message"><div class="who">'+esc(m.profiles?.display_name||m.profiles?.username||"Player")+' <span class="when">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p></div>').join("");
        return '<article class="list-item"><div class="item-head"><strong>'+esc(o.title)+'</strong><span class="pill">'+esc(o.status)+'</span></div><p>'+esc(o.description)+'</p><div class="inline-meta">Von '+esc(o.profiles?.username||"Player")+' · Budget '+(o.budget===null?"offen":number(o.budget)+" ◆")+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch kein Nachrichtenverlauf.</div>')+'</div><form class="chat-compose" data-admin-building-message="'+o.id+'"><input class="input" name="message" maxlength="2000" placeholder="Private Nachricht an Spieler …" required><button class="btn small">Senden</button></form><div class="action-group">'+["reviewing","accepted","in_progress","completed","rejected"].map(s=>'<button class="btn small '+(s==="rejected"?"danger":"secondary")+'" data-building-status="'+s+'" data-id="'+o.id+'">'+s+'</button>').join("")+'</div></article>';
      }).join("")||empty("Keine Building-Aufträge."))+'</div></div>';
    } else if(section==="market"){
      const {data,error}=await db.from("market_items").select("id,symbol,name,active,stock").order("symbol");if(error)throw error;
      node.innerHTML='<div class="card"><h2>Virtuelle Market-Preise</h2><div class="list">'+((data??[]).map(item=>'<form class="list-item market-admin-form" data-item="'+item.id+'"><div class="item-head"><strong>'+esc(item.name)+' · '+esc(item.symbol)+'</strong><span class="pill">'+(item.active?"aktiv":"inaktiv")+'</span></div><div class="form-grid"><div class="field"><label>Neuer Preis (z.B. 2b, 750m, 500k)</label><input class="input" name="price" inputmode="decimal" placeholder="2b" required></div><div class="field"><label>Stock</label><input class="input" name="stock" type="number" min="0" step="1" value="'+item.stock+'"></div><div class="field"><label>Änderungsgrund</label><input class="input" name="reason" maxlength="200" placeholder="Marktanpassung"></div></div><button class="btn small">Preis + Stock speichern</button></form>').join("")||empty("Keine Assets angelegt."))+'</div></div>';
    } else if(section==="market_tickets"){
      const {data,error}=await db.from("market_tickets").select("id,user_id,quantity,message,status,created_at,market_items(name,symbol),profiles(username,display_name)").order("created_at",{ascending:false}).limit(100);
      if(error)throw error;
      const rows=(data??[]).map(t=>'<article class="ticket-row" data-ticket-open="'+t.id+'"><div class="ticket-main"><div class="item-head"><strong>#'+t.id+' · '+esc(t.market_items?.name||"Item")+'</strong><span class="pill '+(t.status==="open"?"red":"")+'">'+esc(t.status)+'</span></div><p><strong>'+esc(t.profiles?.display_name||t.profiles?.username||"Player")+'</strong> · '+number(t.quantity)+'×</p><p class="muted">'+esc(t.message||"Keine Nachricht")+'</p><small>'+dateTime(t.created_at)+'</small></div><div class="ticket-arrow">›</div></article>').join("");
      node.innerHTML='<div class="card"><h2>Market Tickets</h2><p class="muted">Ticket anklicken, Verlauf öffnen und direkt mit dem Spieler schreiben.</p><div class="ticket-list">'+(rows||empty("Keine Market-Tickets."))+'</div></div>';
    } else if(section==="chat"){
      const {data:chatMode}=await db.from("chat_settings").select("mode,slow_seconds").eq("id",1).maybeSingle();
      const [reportResult,messageResult]=await Promise.all([
        db.from("chat_reports").select("id,message_id,reporter_user_id,reason,status,created_at").order("created_at",{ascending:false}).limit(50),
        db.from("chat_messages").select("id,user_id,message,created_at,profiles(username)").is("deleted_at",null).order("created_at",{ascending:false}).limit(40)
      ]);
      if(reportResult.error)throw reportResult.error;if(messageResult.error)throw messageResult.error;
      const reportCards=(reportResult.data??[]).map(r=>'<article class="list-item"><div class="item-head"><strong>Report #'+r.id+'</strong><span class="pill">'+esc(r.status)+'</span></div><p>'+esc(r.reason)+'</p><div class="inline-meta">Message #'+esc(r.message_id)+' · '+dateTime(r.created_at)+'</div><div class="action-group"><button class="btn small secondary" data-report-status="resolved" data-id="'+r.id+'">Erledigt</button><button class="btn small danger" data-delete-message="'+r.message_id+'">Nachricht löschen</button><button class="btn small ghost" data-report-status="dismissed" data-id="'+r.id+'">Dismiss</button></div></article>').join("");
      const messageCards=(messageResult.data??[]).map(m=>'<article class="list-item"><div class="item-head"><strong>'+esc(m.profiles?.username||m.user_id)+'</strong><span class="inline-meta">'+dateTime(m.created_at)+'</span></div><p>'+esc(m.message)+'</p><div class="action-group"><button class="btn small danger" data-delete-message="'+m.id+'">Nachricht löschen</button></div></article>').join("");
      node.innerHTML='<div class="card"><h2>Chat-Steuerung</h2><p class="muted">Admins dürfen immer schreiben.</p><div class="chat-mode-grid"><button class="btn" data-chat-mode="normal">Normal</button><button class="btn" data-chat-mode="slow">Slow Mode</button><button class="btn" data-chat-mode="media">Nur Media</button><button class="btn danger" data-chat-mode="admin">Nur Admins</button></div><div class="form-note">Aktuell: <strong>'+esc(chatMode?.mode||"normal")+'</strong></div></div><div class="grid two"><div class="card"><h2>Offene Meldungen</h2><div class="list">'+(reportCards||empty("Keine Reports vorhanden."))+'</div></div><div class="card"><h2>Letzte Chat-Nachrichten</h2><div class="list">'+(messageCards||empty("Noch keine Nachrichten."))+'</div></div></div>';
    } else if(section==="roles"){
      const {data:users,error}=await db.from("profiles").select("id,username").order("username").limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Rolle zuweisen</h2><form id="role-form" class="form-grid"><div class="field"><label>Spieler</label><select name="user_id">'+(users??[]).map(u=>'<option value="'+u.id+'">'+esc(u.username)+'</option>').join("")+'</select></div><div class="field"><label>Rolle</label><select name="role">'+["user","verified","helper","moderator","media","admin"].map(r=>'<option value="'+r+'">'+r+'</option>').join("")+'</select></div><button class="btn">Rolle zuweisen</button></form><p class="form-note">Rollen werden zusätzlich serverseitig durch Permissions kontrolliert.</p></div>';
    } else if(section==="audit"){
      const {data,error}=await db.from("audit_logs").select("id,actor_user_id,action,target_user_id,metadata,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;
      node.innerHTML='<div class="card"><h2>Audit Logs</h2><div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Aktion</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>'+((data??[]).map(a=>'<tr><td>'+dateTime(a.created_at)+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.actor_user_id)+'</td><td>'+esc(a.target_user_id)+'</td><td>'+esc(JSON.stringify(a.metadata))+'</td></tr>').join("")||'<tr><td colspan="5">Noch keine Aktionen.</td></tr>')+'</tbody></table></div></div>';
    } else if(section==="maintenance"){
      const {data,error}=await db.from("maintenance_windows").select("*").eq("id",1).single();if(error)throw error;
      node.innerHTML='<div class="card"><h2>Website Maintenance</h2><p class="muted">Bei aktivierter Wartung sehen normale Besucher eine Wartungsseite. Admins können die Seite weiterhin verwalten.</p><div class="action-row maintenance-actions"><button type="button" class="btn" data-maintenance-toggle="on">Maintenance AN</button><button type="button" class="btn secondary" data-maintenance-toggle="off">Maintenance OFF</button></div><form id="maintenance-form" class="form"><label class="item-head"><span>Wartungsmodus</span><input type="checkbox" name="enabled" '+(data.enabled?"checked":"")+'></label><div class="field"><label>Nachricht</label><input class="input" name="message" value="'+esc(data.message)+'"></div><button class="btn">Einstellung speichern</button></form></div>';
    } else if(section==="console"){
      node.innerHTML='<div class="card"><h2>Safe Admin Console</h2><p class="muted">Nur freigegebene Website-Befehle. Keine Shell, keine SQL-Konsole.</p><div class="console-command-grid"><button type="button" class="console-command" data-console-command="/maintenance on">Maintenance AN</button><button type="button" class="console-command" data-console-command="/maintenance off">Maintenance AUS</button><button type="button" class="console-command" data-console-command="/announce Server Update|KRAKE SMP Update ist live!">Announcement</button><button type="button" class="console-command" data-console-command="/ban Spieler Regelverstoß">Ban-Vorlage</button><button type="button" class="console-command" data-console-command="/unban Spieler">Unban-Vorlage</button><button type="button" class="console-command" data-console-command="/mute Spieler Chatregel">Mute-Vorlage</button><button type="button" class="console-command" data-console-command="/unmute Spieler">Unmute-Vorlage</button></div><form id="console-form" class="chat-compose"><input class="input" name="command" placeholder="/ban Spieler Regelverstoß" required><button class="btn">Ausführen</button></form><div class="form-note" style="margin-top:12px">Befehle sind klickbar und werden nur als freigegebene Admin-Aktionen ausgeführt.</div><div class="notice" id="console-output" style="margin-top:12px">Warte auf Befehl.</div></div>';
    }
  } catch(error) {
    node.innerHTML='<div class="notice error">Bereich konnte nicht geladen werden: '+esc(error.message)+'</div>';
  }
  wireAdminSection(section);
}
function wireAdminSection(section) {
  const node=$("admin-content");if(!node)return;
  node.onclick=async(event)=>{
    const ticket=event.target.closest("[data-ticket-open]");
    if(ticket){openMarketTicket(Number(ticket.dataset.ticketOpen));return;}

    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.chatMode){try{const seconds=button.dataset.chatMode==="slow"?5:0;await callAdmin("chat_mode",{mode:button.dataset.chatMode,slow_seconds:seconds});toast("Chat-Modus geändert.","success");await loadAdminSection(section);}catch(error){toast(error.message,"error");}return;}
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
      if(button.dataset.ticketStatus){
        const {error}=await db.from("market_tickets").update({status:button.dataset.ticketStatus,handled_by:currentUser.id,updated_at:new Date().toISOString()}).eq("id",Number(button.dataset.id));
        if(error)throw error;
        toast("Market-Ticket aktualisiert.","success");await loadAdminSection(section);
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
    e.preventDefault();const f=new FormData(form);try{const parsed=parsePrice(f.get("price"));if(!Number.isFinite(parsed)||parsed<0)throw new Error("Ungültiger Preis. Beispiele: 2b, 750m, 500k.");
      await callAdmin("market_price",{item_id:form.dataset.item,price:parsed,reason:String(f.get("reason")||"")});await callAdmin("market_stock",{item_id:form.dataset.item,stock:Math.max(0,Number(f.get("stock")||0))});toast("Preis + Stock aktualisiert.","success");form.reset();}catch(error){toast(error.message,"error");}
  });
  $("role-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await callAdmin("set_role",{user_id:String(f.get("user_id")),role:String(f.get("role"))});toast("Rolle zugewiesen.","success");}catch(error){toast(error.message,"error");}
  });
  node.querySelectorAll("[data-maintenance-toggle]").forEach(button=>button.addEventListener("click",async()=>{try{const enabled=button.dataset.maintenanceToggle==="on";await callAdmin("maintenance",{enabled,message:"KRAKE SMP wird gewartet."});toast(enabled?"Maintenance ist AN.":"Maintenance ist OFF.","success");await loadAdminSection("maintenance");}catch(error){toast(error.message,"error");}}));
  $("maintenance-form")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await callAdmin("maintenance",{enabled:e.currentTarget.elements.enabled.checked,message:String(f.get("message")||"")});toast("Maintenance-Einstellung gespeichert.","success");}catch(error){toast(error.message,"error");}
  });
  node.querySelectorAll("[data-console-command]").forEach(button=>button.addEventListener("click",()=>{
    const input=$("console-form")?.elements?.command;
    if(input){input.value=button.dataset.consoleCommand;input.focus();}
  }));
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

let renderStarted = false;
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(label + " hat zu lange gedauert.")), ms))
]);

async function render() {
  if (renderStarted) return;
  renderStarted = true;
  try {
    shell('<section class="page-head"><div class="eyebrow">KRAKE SMP</div><h1>Willkommen</h1><p>Community Portal wird geladen …</p></section><section class="card"><p class="muted">Verbindung wird hergestellt.</p></section>');
  } catch(error) {
    console.error("Initial shell failed", error);
    return;
  }
  try {
    if(!db) throw new Error("Supabase konnte nicht geladen werden.");
    await withTimeout(refreshAuth(), 8000, "Die Anmeldung");
    await withTimeout(renderPage(), 12000, "Die Seite");
    await withTimeout(checkMaintenance(), 5000, "Der Wartungscheck");
  } catch(error) {
    console.error(error);
    shell('<section class="card"><div class="eyebrow">SYSTEM</div><h2>KRAKE SMP konnte nicht vollständig geladen werden.</h2><p class="muted">'+esc(error?.message||"Unbekannter Startfehler")+'</p><button class="btn secondary" onclick="location.reload()">Erneut versuchen</button></section>');
  }
}
window.addEventListener("hashchange",()=>renderPage());
window.addEventListener("load",()=>render());
window.setTimeout(()=>{ if(root && root.querySelector(".boot")) render(); },2500);
