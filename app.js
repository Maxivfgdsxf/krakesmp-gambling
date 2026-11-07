"use strict";

const CFG = window.KRAKE_CONFIG;
const db = window.supabase.createClient(CFG.supabaseUrl, CFG.publishableKey, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
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
const adminMark = () => isAdmin() ? '<span class="admin-badge" title="Administrator">ADMIN</span>' : "";
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
function isAdmin() { return currentUser?.id === "cee3680c-3580-47c5-8c64-0277eac03800" || permissions.includes("users.view") || permissions.includes("roles.manage"); }
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
      <button class="kraken-menu-btn" id="kraken-menu" aria-label="KRAKE Navigation öffnen" title="KRAKE Navigation">${KRAKEN_CREST}</button>
      <a class="brand" href="#home"><span class="brand-logo" aria-hidden="true">${KRAKEN_CREST}</span><span>KRAKE SMP</span></a>
      <label class="global-search"><span>⌕</span><input id="site-search" type="search" placeholder="Suche nach Spielern, Items …" aria-label="Website durchsuchen"></label>
      <div class="top-actions">
        
        
        <span class="account-chip">${esc(display)}${adminMark()}</span>
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
          ${isAdmin()?'<div class="nav-label">Administration</div><button class="nav-link '+(currentRoute==="admin"?'active':'')+'" data-route="admin"><span class="nav-icon">✦</span>Admin Panel</button><button class="nav-link '+(currentRoute==="market-tickets"?'active':'')+'" data-route="market-tickets"><span class="nav-icon">🎫</span>Market Tickets</button>':""}
          <button class="nav-link" id="auth-nav"><span class="nav-icon">${currentUser?"↪":"→"}</span>${currentUser?"Abmelden":"Anmelden"}</button>
        </nav>
      </aside>
    </div>
    <main class="page-wrap" id="page-content">${content}</main>
    <footer class="site-footer">KRAKE SMP · COMMUNITY PORTAL · <a href="#impressum">Impressum</a> · Made by Dev Mundi</footer>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;
  $("kraken-menu").onclick=()=>$( "drawer" )?.classList.toggle("open");
  $("menu-close").onclick=closeDrawer;
  $("drawer-back").onclick=closeDrawer;
  $("account-open").onclick=()=>go(currentUser?"profile":"login");
  
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
        ${currentUser?'<p class="muted home-greeting">Willkommen zurück, <strong>'+esc(hello)+'</strong>.'+(isAdmin()?' <span class="admin-crown">♛ ADMIN</span>':"")+'</p>':'<p class="muted home-greeting">Melde dich an und werde Teil der Community.</p>'}
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

async function renderChat() {
  const messages = await db.from("chat_messages")
    .select("id,user_id,message,created_at,profiles(username,display_name,verified)")
    .is("deleted_at",null).order("created_at",{ascending:false}).limit(100);
  if (messages.error) throw messages.error;
  lastChatMessages = (messages.data??[]).reverse();
  const items = lastChatMessages.map(m=>`
    <article class="chat-message">
      <div><span class="who">${esc(m.profiles?.display_name||m.profiles?.username||"Player")}${badge(m.profiles?.verified)}</span><span class="when">${dateTime(m.created_at)}</span>
      ${currentUser && currentUser.id!==m.user_id?'<button class="btn ghost small" data-report="'+m.id+'">Melden</button>':""}</div>
      <p>${esc(m.message)}</p>
    </article>
  `).join("");
  return pageHead("COMMUNITY","Globaler Chat","Schreib mit der KRAKE Community. Chat-Regeln gelten für alle Mitglieder.")+
    '<section class="card"><div class="chat-window" id="chat-window">'+(items||empty("Noch keine Nachrichten. Starte die Unterhaltung!"))+'</div>'+
    (currentUser?'<form id="chat-form" class="chat-compose"><input class="input" id="chat-input" maxlength="2000" placeholder="Nachricht schreiben …" required><button class="btn" type="submit">Senden</button></form>':'<div class="notice" style="margin-top:12px">Zum Schreiben bitte <button class="btn small" data-route="login">anmelden</button>.</div>')+
    '<p class="form-note">Nachrichten werden moderiert. Melde problematische Inhalte über „Melden“.</p></section>';
}

async function renderLeaderboards() {
  const {data:games,error:gamesError}=await db.from("minigames").select("id,slug,name,description").eq("active",true).order("name");
  if(gamesError) throw gamesError;
  const {data:results,error:resultsError}=await db.from("minigame_results")
    .select("minigame_id,user_id,score,time_ms,won,created_at,minigames(slug,name),profiles(username,display_name,verified)")
    .order("score",{ascending:false}).limit(1000);
  if(resultsError) throw resultsError;
  const groups=new Map((games??[]).map(g=>[g.id,[]]));
  for(const r of (results??[])) if(groups.has(r.minigame_id)) groups.get(r.minigame_id).push(r);
  const cards=(games??[]).map((g,index)=>{
    const rows=groups.get(g.id)||[];
    const sorted=[...rows].sort((a,b)=>{
      if(g.slug==="reaction" && a.time_ms!=null && b.time_ms!=null) return a.time_ms-b.time_ms;
      return Number(b.score||0)-Number(a.score||0);
    }).slice(0,25);
    const body=sorted.map((p,i)=>{
      const player=esc(p.profiles?.display_name||p.profiles?.username||"Player");
      const admin=isAdmin() && p.user_id===currentUser?.id ? adminMark() : "";
      const metric=g.slug==="reaction" && p.time_ms!=null ? p.time_ms+" ms" : number(p.score||0);
      return '<tr><td><span class="rank '+(i===0?"gold":i===1?"silver":i===2?"bronze":"")+'">'+(i+1)+'</span></td><td><strong>'+player+'</strong> '+badge(p.profiles?.verified)+' '+admin+'</td><td>'+metric+'</td><td>'+((p.won?"WIN":"—"))+'</td><td>'+dateTime(p.created_at)+'</td></tr>';
    }).join("");
    return '<section class="leaderboard-game card" data-board="'+esc(g.slug)+'" '+(index===0?"":"hidden")+'><div class="section-head"><div><div class="eyebrow">KRAKE COMPETITIVE</div><h2>'+esc(g.name)+' Leaderboard</h2><p>'+esc(g.description||"Spieler-Rankings")+'</p></div><span class="pill red">TOP 25</span></div><div class="table-wrap"><table><thead><tr><th>#</th><th>Spieler</th><th>Score</th><th>Status</th><th>Datum</th></tr></thead><tbody>'+(body||'<tr><td colspan="5">Noch keine Ergebnisse.</td></tr>')+'</tbody></table></div></section>';
  }).join("");
  const tabs=(games??[]).map((g,i)=>'<button class="leaderboard-tab '+(i===0?"active":"")+'" data-leaderboard-game="'+esc(g.slug)+'">'+esc(g.name)+'</button>').join("");
  return pageHead("COMPETITIVE","Leaderboards","Für jedes Minigame gibt es ein eigenes KRAKE Leaderboard.")+
    '<section class="card leaderboard-shell"><div class="leaderboard-tabs">'+tabs+'</div><div class="leaderboard-panels">'+cards+'</div></section>';
}
async function renderMarket() {
  const [items,prices]=await Promise.all([
    db.from("market_items").select("id,symbol,name,description").eq("active",true).order("name"),
    db.from("market_prices").select("item_id,price,created_at").order("created_at",{ascending:true}).limit(1000)
  ]);
  if(items.error)throw items.error;if(prices.error)throw prices.error;
  const histories=new Map();
  for(const p of (prices.data??[])){if(!histories.has(p.item_id))histories.set(p.item_id,[]);histories.get(p.item_id).push(p);}
  const art=(symbol)=>symbol==="SKELETON"?"☠️":symbol==="ELYTRA_ENCH"?"🪽":symbol==="ELYTRA"?"🪽":"🍎";
  const cards=(items.data??[]).map(item=>{
    const history=histories.get(item.id)||[];
    const latest=history.at(-1);
    const first=history[0]?.price ?? latest?.price ?? 0;
    const change=first ? ((Number(latest?.price||0)-Number(first))/Number(first))*100 : 0;
    const pts=history.slice(-12).map((p,i)=>(i*12)+","+(50-Math.max(-42,Math.min(42,((Number(p.price)-Number(first))/(Number(first)||1))*42)))).join(" ");
    const chart=pts ? '<svg class="price-chart" viewBox="0 0 132 60" preserveAspectRatio="none"><polyline points="'+pts+'" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>' : "";
    return '<article class="market-card card"><div class="market-art market-art-'+esc(item.symbol)+'"><span>'+art(item.symbol)+'</span></div><div class="market-card-body"><div class="eyebrow">INGAME MARKET</div><h2>'+esc(item.name)+'</h2><p>'+esc(item.description||"Minecraft Item")+'</p><div class="market-price-row"><strong>'+compactPrice(latest?.price||0)+'</strong><span class="price-change '+(change>=0?"up":"down")+'">'+(change>=0?"+":"")+change.toFixed(1)+'% seit Start</span></div><div class="market-trend">'+chart+'<div><small>Start</small><b>'+compactPrice(first)+'</b></div><div><small>Aktuell</small><b>'+compactPrice(latest?.price||0)+'</b></div></div><button class="btn market-ticket-btn" data-market-ticket="'+item.id+'">Dieses Item anfragen</button></div></article>';
  }).join("");
  return pageHead("INGAME MARKET","KRAKE Market","Hier werden echte Ingame-Items gehandelt. Preise setzt du selbst im Admin Panel. Kein Website-Guthaben.")+
    '<div class="market-note"><span>◆</span><div><strong>Preisübersicht</strong><p>Preise werden als Ingame-Werte wie <b>2b</b>, <b>750m</b> oder <b>500k</b> angezeigt. Klick auf ein Item, wenn du es kaufen möchtest – daraus wird direkt ein Ticket für das Team.</p></div></div>'+
    '<section class="market-grid">'+(cards||empty("Noch keine Markt-Items vorhanden."))+'</section>';
}
async function renderMinigames() {
  const {data:games,error}=await db.from("minigames").select("id,slug,name,description").eq("active",true).order("name");
  if(error)throw error;
  const icons={reaction:"⚡",speed:"⏱️",duel:"⚔️",memory:"🧠",aim:"🎯",quiz:"❓",decision:"⚖️"};
  const cards=(games??[]).map(g=>'<article class="game-card card"><div class="game-icon">'+(icons[g.slug]||"🎮")+'</div><div><span class="pill green">FREIGESCHALTET</span><h2>'+esc(g.name)+'</h2><p>'+esc(g.description||"Challenge")+'</p></div><button class="btn small" data-game-start="'+esc(g.slug)+'">Spielen</button></article>').join("");
  return pageHead("QUICK COMPETITION","Minigames","Alle KRAKE Minigames sind spielbar – jedes Ergebnis landet im eigenen Leaderboard.")+
    '<section class="games-grid">'+cards+'</section>'+
    '<section class="card game-stage" id="game-stage" hidden><div class="section-head"><div><div class="eyebrow">LIVE GAME</div><h2 id="game-title">Minigame</h2><p id="game-description"></p></div><button class="btn ghost" id="game-close">Schließen</button></div><div id="game-area"></div></section>';
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
    return '<article class="list-item"><div class="item-head"><strong>'+esc(o.title)+'</strong><span class="pill">'+esc(o.status)+'</span></div><p>'+esc(o.description)+'</p><div class="inline-meta">Budget: '+(o.budget===null?"Offen":number(o.budget))+' · '+dateTime(o.created_at)+'</div><div class="list" style="margin:12px 0">'+(history||'<div class="form-note">Noch keine Nachrichten vom Team.</div>')+'</div><form class="chat-compose" data-building-message="'+o.id+'"><input class="input" name="message" maxlength="2000" placeholder="Nachricht an das Team …" required><button class="btn small">Senden</button></form></article>';
  }).join("");
  return pageHead("PLAYER SERVICE","Building Service","Was soll gebaut werden? Das Team kann den Status aktualisieren und mit dir schreiben.")+
    '<div class="grid two"><section class="card"><h2>Neuen Auftrag erstellen</h2><form class="form" id="building-form"><div class="field"><label>Titel</label><input class="input" name="title" maxlength="100" required></div><div class="field"><label>Beschreibung</label><textarea name="description" maxlength="4000" required></textarea></div><div class="field"><label>Budget (optional)</label><input class="input" name="budget" type="number" min="0"></div><button class="btn">Auftrag senden</button></form></section><section class="card"><h2>Deine Aufträge</h2><div class="list">'+(cards||empty("Du hast noch keine Aufträge erstellt."))+'</div></section></div>';
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
  const [stats,minecraft,roles]=await Promise.all([
    db.from("player_statistics").select("*").eq("user_id",currentUser.id).maybeSingle(),
    db.from("minecraft_accounts").select("minecraft_name,verification_status,verified_at").eq("user_id",currentUser.id).maybeSingle(),
    db.from("user_roles").select("roles(display_name,name)").eq("user_id",currentUser.id)
  ]);
  const roleNames=(roles.data??[]).map(r=>r.roles?.display_name||r.roles?.name).filter(Boolean).join(", ")||"User";
  return pageHead("PLAYER ID","Profil","Deine KRAKE SMP Community-Identität.")+
    '<section class="card"><div class="item-head"><div><div class="eyebrow">MEMBER PROFILE</div><h2>'+esc(profile?.display_name||profile?.username||"Player")+badge(profile?.verified)+'</h2><div class="muted">@'+esc(profile?.username||"")+'</div></div><span class="pill red">'+esc(roleNames)+'</span></div><div class="section grid four"><div class="card stat-card"><div class="stat-label">Wins</div><div class="stat-number">'+number(stats.data?.wins)+'</div></div><div class="card stat-card"><div class="stat-label">Games</div><div class="stat-number">'+number(stats.data?.games_played)+'</div></div><div class="card stat-card"><div class="stat-label">Rating</div><div class="stat-number">'+number(stats.data?.rating??1000)+'</div></div></div><div class="section grid two"><div class="list-item"><div class="muted">Minecraft Account</div><strong>'+esc(minecraft.data?.minecraft_name||"Nicht verknüpft")+'</strong><div class="inline-meta">Status: '+esc(minecraft.data?.verification_status||"unverified")+'</div></div><div class="list-item"><div class="muted">Mitglied seit</div><strong>'+dateTime(profile?.created_at)+'</strong><div class="inline-meta">Letzter Login: '+dateTime(profile?.last_login_at)+'</div></div></div><div class="action-row"><button class="btn secondary" data-route="settings">Einstellungen</button><button class="btn ghost" id="logout-btn">Abmelden</button></div></section>';
}

async function renderSettings() {
  if(!currentUser)return pageHead("ACCOUNT CONTROL","Einstellungen","Melde dich an, um deine Einstellungen zu verwalten.")+'<div class="card">'+empty("Bitte zuerst anmelden.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  const {data:mc}=await db.from("minecraft_accounts").select("minecraft_name,verification_status,verified_at").eq("user_id",currentUser.id).maybeSingle();
  const {data:req}=await db.from("verification_requests").select("minecraft_name,status,requested_at").eq("user_id",currentUser.id).order("requested_at",{ascending:false}).limit(1).maybeSingle();
  return pageHead("ACCOUNT CONTROL","Einstellungen","Profil, Minecraft-Verknüpfung und Sicherheit.")+
    '<div class="grid two"><section class="card"><h2>Profil bearbeiten</h2><form class="form" id="profile-form"><div class="field"><label>Anzeigename</label><input class="input" name="display_name" maxlength="32" value="'+esc(profile?.display_name||profile?.username||"")+'"></div><button class="btn">Speichern</button></form></section><section class="card"><h2>Minecraft Account</h2><p class="muted">Die Eingabe eines Namens ist keine automatische Verifizierung. Das Team prüft jeden Antrag manuell.</p><div class="notice">Aktueller Status: <strong>'+esc(mc?.verification_status||req?.status||"Nicht verifiziert")+'</strong>'+(mc?.minecraft_name?' · '+esc(mc.minecraft_name):req?.minecraft_name?' · '+esc(req.minecraft_name):"")+'</div><form class="form" id="verification-form" style="margin-top:12px"><div class="field"><label>Minecraft Java Name</label><input class="input" name="minecraft_name" pattern="[A-Za-z0-9_]{3,16}" maxlength="16" required placeholder="DeinMinecraftName"></div><button class="btn">Verifizierung anfordern</button></form></section><section class="card"><h2>Sicherheit</h2><p class="muted">Passwörter werden ausschließlich von Supabase Auth gehasht gespeichert. Admins können ein Passwort zurücksetzen, aber niemals dein Klartext-Passwort auslesen.</p><div class="pill green">Sichere Sessions aktiv</div><div class="pill">Kein 2FA-Zwang</div></section><section class="card"><h2>Account</h2><p class="muted">Username: <strong>'+esc(profile?.username||"")+'</strong><br>Erstellt: '+dateTime(profile?.created_at)+'</p><button class="btn ghost" id="settings-logout">Abmelden</button></section></div>';
}

async function renderMarketTickets() {
  if(!currentUser)return pageHead("MARKET","Market Tickets","Melde dich an, um deine Tickets zu sehen.")+'<div class="card">'+empty("Bitte anmelden.")+'</div>';
  const {data,error}=await db.from("market_tickets").select("id,quantity,message,status,created_at,updated_at,market_items(name,symbol)").eq("user_id",currentUser.id).order("created_at",{ascending:false});
  if(error)throw error;
  const cards=(data??[]).map(t=>'<article class="list-item"><div class="item-head"><strong>'+esc(t.market_items?.name||"Item")+'</strong><span class="pill '+(t.status==="open"?"red":"")+'">'+esc(t.status)+'</span></div><p>Menge: '+number(t.quantity)+' · '+esc(t.message||"Keine Nachricht")+'</p><div class="inline-meta">Ticket #'+t.id+' · '+dateTime(t.created_at)+'</div></article>').join("");
  return pageHead("MARKET","Deine Market Tickets","Wenn du ein Item anklickst, landet deine Anfrage hier beim Team.")+'<div class="list">'+(cards||empty("Noch keine Market-Tickets."))+'</div>';
}
async function renderImpressum() {
  return pageHead("LEGAL","Impressum","Informationen zum Projekt.")+'<section class="card"><h2>KRAKE SMP</h2><p class="muted">Made by Dev Mundi.</p></section>';
}
async function renderAdmin() {
  if(!currentUser)return pageHead("RESTRICTED","Admin Panel","Nur für autorisierte Teammitglieder.")+'<div class="card">'+empty("Bitte anmelden.")+'<button class="btn" data-route="login">Anmelden</button></div>';
  if(!isAdmin())return pageHead("RESTRICTED","Kein Zugriff","Dein Account besitzt keine Admin-Berechtigung.")+'<div class="card">'+empty("Das Admin Panel ist serverseitig geschützt.")+'</div>';
  return pageHead("CONTROL CENTER","Admin Panel","Serverseitig abgesicherte Verwaltung und Audit-Protokoll.")+
    '<section class="card"><div class="admin-tabs">'+[
      ["overview","Dashboard"],["players","Players"],["bans","Bans"],["verifications","Minecraft"],["applications","Bewerbungen"],["building","Building"],["market","Market"],["market_tickets","Market Tickets"],["chat","Chat Reports"],["roles","Rollen"],["audit","Audit Logs"],["maintenance","Maintenance"],["console","Admin Console"]
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
    else if(route==="market-tickets")content=await renderMarketTickets();
    else if(route==="impressum")content=await renderImpressum();
    else {currentRoute="home";content=await renderHome();}
  } catch(error) {
    console.error(error);
    content='<section class="card"><div class="eyebrow">SYSTEM</div><h2>Dieser Bereich konnte nicht geladen werden.</h2><p class="muted">'+esc(error.message)+'</p><button class="btn secondary" data-route="home">Zur Startseite</button></section>';
  }
  shell(content);
  wirePage(route);
  if(route==="admin" && isAdmin()) await loadAdminSection(adminSection);
}

function wireMarket() {
  document.querySelectorAll("[data-market-ticket]").forEach(button=>button.addEventListener("click",async()=>{
    if(!currentUser){go("login");return;}
    const itemId=button.dataset.marketTicket;
    const rawQuantity=prompt("Wie viele möchtest du?","1"); if(rawQuantity===null)return;
    const q=Math.floor(Number(rawQuantity));
    if(!Number.isFinite(q)||q<1){toast("Ungültige Menge.","error");return;}
    const message=prompt("Nachricht an das Team (optional):","Ich möchte dieses Item kaufen."); if(message===null)return;
    const {error}=await db.from("market_tickets").insert({user_id:currentUser.id,item_id:itemId,quantity:q,message:String(message).slice(0,2000)});
    if(error)toast(error.message,"error");else{toast("Ticket erstellt. Das Team sieht deine Anfrage im Admin Panel.","success");await renderPage();}
  }));
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
  if(route==="market")wireMarket();
  if(route==="leaderboards"){
    document.querySelectorAll("[data-leaderboard-game]").forEach(button=>button.addEventListener("click",()=>{
      document.querySelectorAll("[data-leaderboard-game]").forEach(b=>b.classList.toggle("active",b===button));
      document.querySelectorAll("[data-board]").forEach(panel=>panel.hidden=panel.dataset.board!==button.dataset.leaderboardGame);
    }));
  }
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
  const {data,error}=await db.from("chat_messages").select("id,user_id,message,created_at,profiles(username,display_name,verified)")
    .is("deleted_at",null).order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  const node=$("chat-window");if(!node)return;
  node.innerHTML=(data??[]).reverse().map(m=>'<article class="chat-message"><div><span class="who">'+esc(m.profiles?.display_name||m.profiles?.username||"Player")+badge(m.profiles?.verified)+'</span><span class="when">'+dateTime(m.created_at)+'</span>'+(currentUser&&currentUser.id!==m.user_id?'<button class="btn ghost small" data-report="'+m.id+'">Melden</button>':"")+'</div><p>'+esc(m.message)+'</p></article>').join("")||empty("Noch keine Nachrichten. Starte die Unterhaltung!");
  node.scrollTop=node.scrollHeight;
}
function wireChat() {
  $("chat-form")?.addEventListener("submit",async event=>{
    event.preventDefault();if(!currentUser){toast("Bitte zuerst anmelden.","error");return;}
    const input=$("chat-input");const message=input.value.trim();if(!message)return;
    const submit=event.currentTarget.querySelector("button[type=submit],button:not([type])");
    if(submit)submit.disabled=true;
    const {error}=await db.from("chat_messages").insert({user_id:currentUser.id,message});
    if(submit)submit.disabled=false;
    if(error){
      console.error("Chat send failed",error);
      const reason=error.code==="42501"?"Du darfst gerade nicht schreiben. Prüfe, ob dein Account stummgeschaltet oder gesperrt ist.":error.message;
      toast(reason,"error");return;
    }
    input.value="";
    try{await loadChatMessages();}catch(refreshError){console.error(refreshError);}
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
  const stage=$("game-stage"), area=$("game-area");
  if(!stage||!area)return;
  const names={reaction:"Reaction",speed:"Speed Challenge",duel:"Duel",memory:"Memory",aim:"Aim",quiz:"Quiz Duel",decision:"Quick Decision"};
  const save=async(slug,score,timeMs,won,metadata={})=>{
    const {data:game}=await db.from("minigames").select("id").eq("slug",slug).single();
    if(!game)return;
    const {error}=await db.from("minigame_results").insert({minigame_id:game.id,user_id:currentUser.id,score:Math.max(0,Math.round(score||0)),time_ms:timeMs??null,won:Boolean(won),metadata});
    if(error)toast("Ergebnis konnte nicht gespeichert werden: "+error.message,"error");else toast("Ergebnis gespeichert!","success");
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
      const qs=[["Wie viele Herzen hat ein Minecraft-Spieler?",["10","20","30"],1],["Welches Item macht einen Beacon?",["Netherstern","Diamant","Enderperle"],0],["Welche Dimension hat den Enderdrachen?",["Nether","End","Overworld"],1],["Was braucht man für einen Crafting Table?",["4 Holzplanken","8 Eisen","1 Stein"],0],["Welches Mob explodiert?",["Creeper","Skeleton","Villager"],0]];let i=0,score=0;
      const draw=()=>{const q=qs[i];area.innerHTML='<div class="quiz-box"><h3>'+esc(q[0])+'</h3><div class="quiz-options">'+q[1].map((a,j)=>'<button class="btn secondary" data-quiz="'+j+'">'+esc(a)+'</button>').join("")+'</div><p class="muted">'+(i+1)+"/"+qs.length+'</p></div>';document.querySelectorAll("[data-quiz]").forEach(btn=>btn.onclick=async()=>{if(Number(btn.dataset.quiz)===q[2])score+=200;i++;if(i<qs.length)draw();else{area.innerHTML='<div class="game-center"><h2>Quiz beendet</h2><p>Score: '+score+'</p></div>';await save(slug,score,null,score>=600,{correct:score/200});}})};draw();
    } else if(slug==="decision"){
      let round=0,score=0;const draw=()=>{area.innerHTML='<div class="game-center"><h2>Quick Decision</h2><p>Wähle schnell.</p><div class="action-row"><button class="btn" data-decision="left">LINKS</button><button class="btn secondary" data-decision="right">RECHTS</button></div><p class="muted">Runde '+(round+1)+"/8</p></div>';document.querySelectorAll("[data-decision]").forEach(btn=>btn.onclick=async()=>{if(Math.random()>.5)score+=150;round++;if(round<8)draw();else{area.innerHTML='<div class="game-center"><h2>Fertig</h2><p>Score: '+score+'</p></div>';await save(slug,score,null,score>=600,{rounds:8});}})};draw();
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
      const [players,bans,verifications,applications,orders,reports]=await Promise.all([
        countRows("profiles"),countRows("bans"),countRows("verification_requests"),countRows("applications"),countRows("building_orders"),countRows("chat_reports")
      ]);
      node.innerHTML='<div class="grid four"><div class="card stat-card"><div class="stat-label">Spieler</div><div class="stat-number">'+players+'</div></div><div class="card stat-card"><div class="stat-label">Bans</div><div class="stat-number">'+bans+'</div></div><div class="card stat-card"><div class="stat-label">Verifizierungen</div><div class="stat-number">'+verifications+'</div></div><div class="card stat-card"><div class="stat-label">Reports</div><div class="stat-number">'+reports+'</div></div></div><div class="card"><h2>Admin-Bereich bereit</h2><p class="muted">Jede privilegierte Aktion wird serverseitig geprüft und in Audit Logs gespeichert. Nutze die Tabs, um Spieler, Anträge, Chat und Website-Einstellungen zu verwalten.</p><span class="pill green">RLS aktiv</span> <span class="pill green">RBAC aktiv</span> <span class="pill green">Audit aktiv</span></div>';
    } else if(section==="players"){
      const {data,error}=await db.from("profiles").select("id,username,display_name,verified,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;
      const rows=(data??[]).map(p=>'<tr><td><strong>'+esc(p.display_name||p.username)+badge(p.verified)+'</strong></td><td>'+esc(p.username)+'</td><td>'+dateTime(p.created_at)+'</td><td><button class="btn small danger" data-player-action="ban" data-user="'+p.id+'">Bannen</button> <button class="btn small secondary" data-player-action="mute" data-user="'+p.id+'">Muten</button> <button class="btn small ghost" data-player-action="password" data-user="'+p.id+'">Passwort reset</button></td></tr>').join("");
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
      const {data,error}=await db.from("market_items").select("id,symbol,name,active").order("symbol");if(error)throw error;
      node.innerHTML='<div class="card"><h2>Virtuelle Market-Preise</h2><div class="list">'+((data??[]).map(item=>'<form class="list-item market-admin-form" data-item="'+item.id+'"><div class="item-head"><strong>'+esc(item.name)+' · '+esc(item.symbol)+'</strong><span class="pill">'+(item.active?"aktiv":"inaktiv")+'</span></div><div class="form-grid"><div class="field"><label>Neuer Preis (z.B. 2b, 750m, 500k)</label><input class="input" name="price" inputmode="decimal" placeholder="2b" required></div><div class="field"><label>Änderungsgrund</label><input class="input" name="reason" maxlength="200" placeholder="Marktanpassung"></div></div><button class="btn small">Preis speichern</button></form>').join("")||empty("Keine Assets angelegt."))+'</div></div>';
    } else if(section==="market_tickets"){
      const {data,error}=await db.from("market_tickets").select("id,user_id,quantity,message,status,created_at,market_items(name,symbol),profiles(username,display_name)").order("created_at",{ascending:false}).limit(100);
      if(error)throw error;
      const rows=(data??[]).map(t=>'<article class="list-item"><div class="item-head"><strong>#'+t.id+' · '+esc(t.market_items?.name||"Item")+'</strong><span class="pill '+(t.status==="open"?"red":"")+'">'+esc(t.status)+'</span></div><p><strong>'+esc(t.profiles?.display_name||t.profiles?.username||"Player")+'</strong> · Menge '+number(t.quantity)+'</p><p>'+esc(t.message||"Keine Nachricht")+'</p><div class="inline-meta">'+dateTime(t.created_at)+'</div><div class="action-group"><button class="btn small secondary" data-ticket-status="in_progress" data-id="'+t.id+'">In Bearbeitung</button><button class="btn small" data-ticket-status="closed" data-id="'+t.id+'">Schließen</button></div></article>').join("");
      node.innerHTML='<div class="card"><h2>Market Tickets</h2><p class="muted">Anfragen von Spielern, die ein Ingame-Item aus dem Market kaufen möchten.</p><div class="list">'+(rows||empty("Keine Market-Tickets."))+'</div></div>';
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
      await callAdmin("market_price",{item_id:form.dataset.item,price:parsed,reason:String(f.get("reason")||"")});toast("Preis aktualisiert.","success");form.reset();}catch(error){toast(error.message,"error");}
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
