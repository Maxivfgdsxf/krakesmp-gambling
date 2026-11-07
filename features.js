/* KRAKE SMP feature pack — keeps the existing visual system and app services. */
(function () {
  "use strict";
  const baseRenderPage = renderPage;
  const baseWirePage = wirePage;
  const baseRenderHome = renderHome;
  const baseRenderProfile = renderProfile;
  const baseRenderSettings = renderSettings;
  const baseRenderEvents = renderEvents;
  const baseRenderMarket = renderMarket;
  const baseRenderMinigames = renderMinigames;
  let eventCountdownTimer = null;
  let extraGameTimer = null;

  NAV.push(
    ["dashboard", "▣", "Spielerhub", "Account"],
    ["friends", "♧", "Freunde", "Account"],
    ["notifications", "◉", "Mitteilungen", "Account"]
  );
  VALID_ROUTES.add("dashboard");
  VALID_ROUTES.add("friends");
  VALID_ROUTES.add("notifications");

  const todayKey = () => new Date().toLocaleDateString("en-CA");
  const routeLogin = (title) => pageHead("KRAKE ACCOUNT", title, "Melde dich an, um diesen Bereich zu nutzen.") +
    '<section class="card"><p class="muted">Dein KRAKE SMP Account schaltet diesen Bereich frei.</p><button class="btn" data-route="login">Anmelden</button></section>';
  const progressBar = (value, max) => {
    const pct = Math.max(0, Math.min(100, max ? (Number(value || 0) / Number(max)) * 100 : 0));
    return '<div class="krake-progress"><span style="width:' + pct.toFixed(1) + '%"></span></div>';
  };
  const personName = (p) => esc(p?.display_name || p?.username || "Spieler");
  const profileMapFor = async (ids) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const { data, error } = await db.from("profiles").select("id,username,display_name,verified,avatar_url").in("id", unique);
    if (error) throw error;
    return new Map((data || []).map(p => [p.id, p]));
  };

  async function renderDashboard() {
    if (!currentUser) return routeLogin("Dein Spielerhub");
    await db.rpc("ensure_player_quests");
    const [progressRes, balanceRes, questsRes, achievementsRes, allAchievementsRes, notificationsRes, eventsRes, statsRes] = await Promise.all([
      db.from("player_progress").select("xp,level,current_streak,longest_streak,last_daily_claim").eq("user_id", currentUser.id).maybeSingle(),
      db.from("user_balances").select("balance").eq("user_id", currentUser.id).maybeSingle(),
      db.from("player_quests").select("id,progress,completed_at,period_start,quest_templates(title,description,recurrence,target_count,xp_reward,coin_reward)").eq("user_id", currentUser.id).order("period_start", { ascending: false }),
      db.from("user_achievements").select("unlocked_at,achievements(title,description,icon,slug)").eq("user_id", currentUser.id).order("unlocked_at", { ascending: false }),
      db.from("achievements").select("id,slug,title,description,icon").eq("active", true),
      db.from("notifications").select("id,title,body,kind,target_route,created_at,read_at").eq("user_id", currentUser.id).is("read_at", null).order("created_at", { ascending: false }).limit(5),
      db.from("events").select("id,name,description,starts_at,ends_at,active").eq("active", true).order("starts_at", { ascending: true }).limit(3),
      db.from("player_statistics").select("games_played,wins,losses,rating").eq("user_id", currentUser.id).maybeSingle()
    ]);
    for (const r of [progressRes,balanceRes,questsRes,achievementsRes,allAchievementsRes,notificationsRes,eventsRes,statsRes]) if (r.error) throw r.error;
    const p = progressRes.data || { xp: 0, level: 1, current_streak: 0, longest_streak: 0 };
    const level = Number(p.level || 1), xp = Number(p.xp || 0);
    const levelStart = Math.pow(level - 1, 2) * 100, levelEnd = Math.pow(level, 2) * 100;
    const levelProgress = Math.max(0, xp - levelStart), levelSpan = Math.max(1, levelEnd - levelStart);
    const canClaim = p.last_daily_claim !== todayKey();
    const questCards = (questsRes.data || []).filter(q => q.period_start === (q.quest_templates?.recurrence === "weekly" ? new Date(new Date().setDate(new Date().getDate() - ((new Date().getDay() + 6) % 7))).toLocaleDateString("en-CA") : todayKey()));
    const qHtml = questCards.map(q => {
      const t = q.quest_templates || {};
      return '<article class="quest-row"><div class="item-head"><strong>' + esc(t.title || "Quest") + '</strong><span class="pill ' + (q.completed_at ? "green" : "") + '">' + (q.completed_at ? "ABGESCHLOSSEN" : (t.recurrence === "weekly" ? "WÖCHENTLICH" : "TÄGLICH")) + '</span></div><p>' + esc(t.description || "") + '</p>' +
        progressBar(q.progress, t.target_count) + '<div class="inline-meta">' + number(q.progress) + ' / ' + number(t.target_count) + ' · +' + number(t.xp_reward) + ' XP · +' + number(t.coin_reward) + ' Coins</div></article>';
    }).join("");
    const unlocked = new Set((achievementsRes.data || []).map(a => a.achievements?.slug));
    const achievementHtml = (allAchievementsRes.data || []).map(a => {
      const done = unlocked.has(a.slug);
      return '<div class="achievement-tile ' + (done ? "unlocked" : "locked") + '"><span class="achievement-icon">' + esc(a.icon) + '</span><strong>' + esc(a.title) + '</strong><small>' + esc(a.description) + '</small><span class="pill ' + (done ? "green" : "") + '">' + (done ? "FREIGESCHALTET" : "GESPERRT") + '</span></div>';
    }).join("");
    const eventHtml = (eventsRes.data || []).map(e => '<article class="event-count-card"><div class="item-head"><strong>' + esc(e.name) + '</strong><span class="pill red">LIVE / GEPLANT</span></div><p>' + esc(e.description || "") + '</p><div class="countdown" data-countdown="' + esc(e.starts_at) + '" data-countdown-end="' + esc(e.ends_at || "") + '">Lädt …</div></article>').join("");
    const unread = (notificationsRes.data || []).length;
    const stats = statsRes.data || {};
    return pageHead("PLAYER HUB", "Dein KRAKE Dashboard", "Dein Fortschritt, deine Quests und alles Wichtige an einem Ort.") +
      '<section class="hub-hero card"><div><div class="eyebrow">WILLKOMMEN ZURÜCK</div><h2>' + personName(profile) + '</h2><p class="muted">Dein nächstes Level wartet bereits.</p></div><div class="hub-level"><span>LEVEL</span><strong>' + number(level) + '</strong><small>' + number(xp) + ' XP</small></div>' +
      progressBar(levelProgress, levelSpan) + '<div class="inline-meta">' + number(levelProgress) + ' / ' + number(levelSpan) + ' XP bis Level ' + (level + 1) + '</div></section>' +
      '<section class="grid four hub-stats"><article class="card stat-card"><div class="stat-label">KRAKE Coins</div><div class="stat-number">' + number(balanceRes.data?.balance || 0) + '</div></article><article class="card stat-card"><div class="stat-label">Login-Serie</div><div class="stat-number">' + number(p.current_streak) + ' Tage</div></article><article class="card stat-card"><div class="stat-label">Minigames</div><div class="stat-number">' + number(stats.games_played || 0) + '</div></article><article class="card stat-card"><div class="stat-label">Siege</div><div class="stat-number">' + number(stats.wins || 0) + '</div></article></section>' +
      '<section class="grid two"><article class="card"><div class="home-card-head"><div><span class="eyebrow">DAILY REWARD</span><h2>Tagesbelohnung</h2></div><span class="pill red">' + (canClaim ? "BEREIT" : "ABGEHOLT") + '</span></div><p class="muted">Komm täglich zurück und baue deine Serie aus. Extra-Boni warten an Tag 7, 14 und 30.</p><div class="daily-reward-values"><strong>+ XP</strong><strong>+ Coins</strong></div><button class="btn" id="claim-daily" ' + (canClaim ? "" : "disabled") + '>' + (canClaim ? "Belohnung abholen" : "Heute bereits abgeholt") + '</button><div class="inline-meta">Längste Serie: ' + number(p.longest_streak) + ' Tage</div></article>' +
      '<article class="card"><div class="home-card-head"><div><span class="eyebrow">MISSIONS</span><h2>Deine Quests</h2></div><span class="pill">' + questCards.length + ' AKTIV</span></div><div class="quest-list">' + (qHtml || empty("Quests werden vorbereitet.")) + '</div></article></section>' +
      '<section class="card"><div class="home-card-head"><div><span class="eyebrow">ACHIEVEMENTS</span><h2>Abzeichen</h2></div><span class="pill">' + unlocked.size + ' / ' + (allAchievementsRes.data || []).length + '</span></div><div class="achievement-grid">' + (achievementHtml || empty("Noch keine Abzeichen verfügbar.")) + '</div></section>' +
      '<section class="grid two"><article class="card"><div class="home-card-head"><div><span class="eyebrow">UPDATES</span><h2>Mitteilungen</h2></div><a href="#notifications">Alle anzeigen →</a></div>' + ((notificationsRes.data || []).map(n => '<div class="list-item"><strong>' + esc(n.title) + '</strong><p>' + esc(n.body) + '</p><small>' + dateTime(n.created_at) + '</small></div>').join("") || empty("Keine neuen Mitteilungen.")) + '<button class="btn secondary small" data-route="notifications">Postfach öffnen (' + unread + ')</button></article>' +
      '<article class="card"><div class="home-card-head"><div><span class="eyebrow">SOCIAL</span><h2>Freunde</h2></div><a href="#friends">Freunde verwalten →</a></div><p class="muted">Finde andere KRAKE-Spieler, sende Anfragen und baue deine Crew auf.</p><button class="btn" data-route="friends">Spieler finden</button></article></section>' +
      '<section class="card"><div class="home-card-head"><div><span class="eyebrow">EVENTS</span><h2>Als Nächstes</h2></div><a href="#events">Alle Events →</a></div><div class="grid two">' + (eventHtml || empty("Aktuell sind keine Events geplant.")) + '</div></section>';
  }

  async function renderFriends() {
    if (!currentUser) return routeLogin("Freunde");
    const { data: rows, error } = await db.from("friendships").select("id,requester_id,addressee_id,status,created_at").or("requester_id.eq." + currentUser.id + ",addressee_id.eq." + currentUser.id).order("created_at", { ascending: false });
    if (error) throw error;
    const ids = (rows || []).flatMap(r => [r.requester_id,r.addressee_id]);
    const people = await profileMapFor(ids);
    const incoming = (rows || []).filter(r => r.status === "pending" && r.addressee_id === currentUser.id);
    const outgoing = (rows || []).filter(r => r.status === "pending" && r.requester_id === currentUser.id);
    const accepted = (rows || []).filter(r => r.status === "accepted");
    const friendCards = accepted.map(r => {
      const other = r.requester_id === currentUser.id ? r.addressee_id : r.requester_id;
      const p = people.get(other);
      return '<article class="friend-card"><div class="friend-avatar">' + esc((p?.username || "K").slice(0,1).toUpperCase()) + '</div><div class="friend-copy"><strong>' + personName(p) + '</strong><small>@' + esc(p?.username || "") + '</small></div><span class="pill green">FREUND</span><button class="btn ghost small danger" data-friend-remove="' + r.id + '">Entfernen</button></article>';
    }).join("");
    const incomingCards = incoming.map(r => {
      const p = people.get(r.requester_id);
      return '<article class="friend-card"><div class="friend-avatar">' + esc((p?.username || "K").slice(0,1).toUpperCase()) + '</div><div class="friend-copy"><strong>' + personName(p) + '</strong><small>@' + esc(p?.username || "") + ' möchte dich hinzufügen</small></div><button class="btn small" data-friend-accept="' + r.id + '">Annehmen</button><button class="btn ghost small" data-friend-decline="' + r.id + '">Ablehnen</button></article>';
    }).join("");
    const outgoingCards = outgoing.map(r => '<article class="friend-card"><div class="friend-copy"><strong>' + personName(people.get(r.addressee_id)) + '</strong><small>Anfrage gesendet</small></div><span class="pill">AUSSTEHEND</span></article>').join("");
    return pageHead("SOCIAL", "Freunde & Spielersuche", "Finde Spieler, sende Freundschaftsanfragen und verwalte deine Crew.") +
      '<section class="card"><div class="eyebrow">PLAYER SEARCH</div><h2>Spieler finden</h2><form id="friend-search-form" class="chat-compose"><input class="input" id="friend-search" minlength="2" maxlength="20" placeholder="Benutzername suchen …" required><button class="btn">Suchen</button></form><div id="friend-search-results" class="friend-list"></div></section>' +
      '<section class="grid two"><article class="card"><div class="home-card-head"><div><span class="eyebrow">INCOMING</span><h2>Anfragen</h2></div><span class="pill">' + incoming.length + '</span></div><div class="friend-list">' + (incomingCards || empty("Keine offenen Anfragen.")) + '</div></article>' +
      '<article class="card"><div class="home-card-head"><div><span class="eyebrow">YOUR CREW</span><h2>Deine Freunde</h2></div><span class="pill green">' + accepted.length + '</span></div><div class="friend-list">' + (friendCards || empty("Deine Freundesliste ist noch leer.")) + '</div><div class="friend-list">' + (outgoingCards || "") + '</div></article></section>';
  }

  async function renderNotifications() {
    if (!currentUser) return routeLogin("Mitteilungen");
    const { data, error } = await db.from("notifications").select("id,kind,title,body,target_route,created_at,read_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const cards = (data || []).map(n => '<article class="notification-row ' + (n.read_at ? "read" : "unread") + '"><div class="notification-dot"></div><div class="notification-copy"><strong>' + esc(n.title) + '</strong><p>' + esc(n.body) + '</p><small>' + dateTime(n.created_at) + '</small></div><div class="notification-actions">' + (n.read_at ? '<span class="pill">GELESEN</span>' : '<button class="btn small secondary" data-notification-read="' + n.id + '">Gelesen</button>') + '<button class="btn ghost small" data-notification-open="' + esc(n.target_route || "dashboard") + '">Öffnen</button></div></article>').join("");
    return pageHead("INBOX", "Mitteilungen", "Freundschaftsanfragen, Belohnungen und wichtige Updates.") + '<section class="card"><div class="notification-list">' + (cards || empty("Du hast noch keine Mitteilungen.")) + '</div></section>';
  }

  renderHome = async function () {
    const html = await baseRenderHome();
    if (!currentUser) return html;
    const { data: p } = await db.from("player_progress").select("level,xp").eq("user_id", currentUser.id).maybeSingle();
    return html + '<section class="card hub-home-strip"><div><span class="eyebrow">DEIN SPIELERHUB</span><h2>Level ' + number(p?.level || 1) + ' · ' + number(p?.xp || 0) + ' XP</h2><p class="muted">Tagesbelohnung, Quests, Achievements und Freunde im Überblick.</p></div><button class="btn" data-route="dashboard">Dashboard öffnen →</button></section>';
  };

  renderSettings = async function () {
    const html = await baseRenderSettings();
    if (!currentUser) return html;
    const { data: details, error } = await db.from("profiles").select("bio,favorite_game").eq("id", currentUser.id).maybeSingle();
    if (error) throw error;
    return html + '<section class="card profile-edit-card"><div class="eyebrow">PLAYER IDENTITY</div><h2>Profil erweitern</h2><form id="profile-details-form" class="form"><div class="field"><label for="profile-bio">Über mich</label><textarea class="input" id="profile-bio" name="bio" rows="3" maxlength="240" placeholder="Erzähl der Community etwas über dich …">' + esc(details?.bio || "") + '</textarea></div><div class="field"><label for="favorite-game">Lieblings-Minispiel</label><input class="input" id="favorite-game" name="favorite_game" maxlength="40" value="' + esc(details?.favorite_game || "") + '" placeholder="z. B. Reaction"></div><button class="btn">Profil-Details speichern</button></form></section>';
  };

  renderProfile = async function () {
    const html = await baseRenderProfile();
    if (!currentUser) return html;
    const [{ data: p }, { data: progress }, { data: earned }, { data: friendRows }] = await Promise.all([
      db.from("profiles").select("bio,favorite_game,profile_banner_url").eq("id", currentUser.id).maybeSingle(),
      db.from("player_progress").select("xp,level,current_streak").eq("user_id", currentUser.id).maybeSingle(),
      db.from("user_achievements").select("unlocked_at,achievements(title,icon)").eq("user_id", currentUser.id).order("unlocked_at", { ascending: false }).limit(6),
      db.from("friendships").select("id").or("requester_id.eq." + currentUser.id + ",addressee_id.eq." + currentUser.id).eq("status", "accepted")
    ]);
    const tags = (earned || []).map(a => '<span class="pill">' + esc(a.achievements?.icon || "🏆") + ' ' + esc(a.achievements?.title || "Achievement") + '</span>').join("");
    const levelCard = html.replace(/<div class="stat-label">Elo Rating<\/div><div class="stat-number">[^<]*<\/div>/, '<div class="stat-label">Level</div><div class="stat-number">' + number(progress?.level || 1) + '</div>');
    return levelCard + '<section class="card profile-expansion"><div class="home-card-head"><div><span class="eyebrow">PLAYER CARD</span><h2>Spieler-Details</h2></div><span class="pill red">LEVEL ' + number(progress?.level || 1) + '</span></div><p>' + esc(p?.bio || "Noch keine Profilbeschreibung hinzugefügt.") + '</p><div class="grid four"><div class="stat-card"><div class="stat-label">XP</div><div class="stat-number">' + number(progress?.xp || 0) + '</div></div><div class="stat-card"><div class="stat-label">Login-Serie</div><div class="stat-number">' + number(progress?.current_streak || 0) + '</div></div><div class="stat-card"><div class="stat-label">Freunde</div><div class="stat-number">' + number(friendRows?.length || 0) + '</div></div><div class="stat-card"><div class="stat-label">Lieblingsspiel</div><div class="stat-number profile-fav">' + esc(p?.favorite_game || "—") + '</div></div></div><div class="action-row">' + (tags || '<span class="muted">Noch keine Abzeichen.</span>') + '</div><button class="btn secondary small" data-route="dashboard">Zum Spielerhub</button></section>';
  };

  renderEvents = async function () {
    if (eventCountdownTimer) clearInterval(eventCountdownTimer);
    const { data, error } = await db.from("events").select("id,name,description,banner_url,starts_at,ends_at,active,config").order("starts_at", { ascending: true });
    if (error) throw error;
    const html = (data || []).map(e => '<article class="card event-feature-card"><div class="item-head"><span class="pill ' + (e.active ? "red" : "") + '">' + (e.active ? "AKTIV" : "GEPLANT") + '</span><span class="form-note">' + dateTime(e.starts_at) + '</span></div><h2>' + esc(e.name) + '</h2><p>' + esc(e.description || "Weitere Informationen folgen.") + '</p><div class="countdown" data-countdown="' + esc(e.starts_at) + '" data-countdown-end="' + esc(e.ends_at || "") + '"></div>' + (e.ends_at ? '<div class="inline-meta">Endet: ' + dateTime(e.ends_at) + '</div>' : "") + '</article>').join("");
    return pageHead("LIVE EVENTS", "KRAKE Events", "Community-Events mit Start-Countdown und Live-Status.") + '<section class="grid two">' + (html || empty("Momentan ist kein Event eingetragen.")) + '</section>';
  };

  renderMarket = async function () {
    const html = await baseRenderMarket();
    if (!currentUser) return html;
    const { data: watched, error } = await db.from("market_watchlist").select("item_id").eq("user_id", currentUser.id);
    if (error) throw error;
    const set = new Set((watched || []).map(x => x.item_id));
    return html.replace(/<button class="btn market-ticket-btn" data-market-ticket="([^"]+)">/g, (match, id) =>
      '<button class="btn secondary small market-watch-btn" data-watch-item="' + id + '">' + (set.has(id) ? "★ Gemerkt" : "☆ Merken") + '</button> ' + match
    );
  };

  renderMinigames = async function () {
    if (currentUser) { const { error } = await db.rpc("ensure_player_quests"); if (error) throw error; }
    const html = await baseRenderMinigames();
    return html.replace(/data-game-start="(click-rush|typing-rush)"/g, 'data-extra-game-start="$1"');
  };

  const baseRenderPageRef = baseRenderPage;
  renderPage = async function () {
    const route = (location.hash.slice(1) || "home").split("?")[0].split("/")[0] || "home";
    if (!["dashboard","friends","notifications"].includes(route)) {
      if (eventCountdownTimer) { clearInterval(eventCountdownTimer); eventCountdownTimer = null; }
      if (extraGameTimer) { clearInterval(extraGameTimer); extraGameTimer = null; }
      return baseRenderPageRef();
    }
    const requestId = ++navigationRequestId;
    if (activeChatChannel) { await db.removeChannel(activeChatChannel); activeChatChannel = null; }
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
    if (reactionTimeout) { clearTimeout(reactionTimeout); reactionTimeout = null; }
    if (eventCountdownTimer) { clearInterval(eventCountdownTimer); eventCountdownTimer = null; }
    if (extraGameTimer) { clearInterval(extraGameTimer); extraGameTimer = null; }
    currentRoute = route;
    let html = "";
    try {
      if (route === "dashboard") html = await renderDashboard();
      else if (route === "friends") html = await renderFriends();
      else html = await renderNotifications();
    } catch (error) {
      console.error("Player hub:", error);
      html = navigationError("Spielerhub konnte nicht geladen werden", error?.message || "Unbekannter Fehler.");
    }
    if (requestId !== navigationRequestId) return;
    shell(html);
    wirePage(route);
    wireNavigationErrorRetry();
  };

  wirePage = function (route) {
    baseWirePage(route);
    if (route === "dashboard") { wireDashboard(); startEventCountdowns(); }
    if (route === "settings") wireProfileDetails();
    if (route === "friends") wireFriends();
    if (route === "notifications") wireNotifications();
    if (route === "market") wireMarketWatchlist();
    if (route === "events") startEventCountdowns();
    if (route === "minigames") {
      db.rpc("ensure_player_quests").catch(err => console.warn("Quest init:", err.message));
      wireExtraMinigames();
    }
  };

  function wireProfileDetails() {
    $("profile-details-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const { error } = await db.from("profiles").update({ bio: String(f.get("bio") || "").trim(), favorite_game: String(f.get("favorite_game") || "").trim() || null, updated_at: new Date().toISOString() }).eq("id", currentUser.id);
      if (error) toast(error.message, "error"); else { await refreshAuth(); toast("Profil-Details gespeichert.", "success"); await renderPage(); }
    });
  }

  function wireDashboard() {
    $("claim-daily")?.addEventListener("click", async e => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        const { data, error } = await db.rpc("claim_daily_reward");
        if (error) throw error;
        toast("Tagesbelohnung: +" + number(data?.xp) + " XP und +" + number(data?.coins) + " Coins · Serie " + number(data?.streak), "success");
        await renderPage();
      } catch (err) {
        button.disabled = false;
        toast(err.message || "Belohnung konnte nicht abgeholt werden.", "error");
      }
    });
  }

  function wireFriends() {
    $("friend-search-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const q = $("friend-search").value.trim();
      const host = $("friend-search-results");
      if (q.length < 2) return;
      host.innerHTML = '<div class="muted">Suche Spieler …</div>';
      try {
        const { data, error } = await db.from("profiles").select("id,username,display_name,verified").ilike("username", "%" + q + "%").neq("id", currentUser.id).order("username").limit(12);
        if (error) throw error;
        const { data: relations, error: relError } = await db.from("friendships").select("id,requester_id,addressee_id,status").or("requester_id.eq." + currentUser.id + ",addressee_id.eq." + currentUser.id);
        if (relError) throw relError;
        const relationFor = id => (relations || []).find(r => (r.requester_id === currentUser.id && r.addressee_id === id) || (r.requester_id === id && r.addressee_id === currentUser.id));
        host.innerHTML = (data || []).map(p => {
          const rel = relationFor(p.id);
          let action = '<button class="btn small" data-friend-send="' + p.id + '">Hinzufügen</button>';
          if (rel?.status === "accepted") action = '<span class="pill green">Bereits Freunde</span>';
          else if (rel?.status === "pending" && rel.addressee_id === currentUser.id) action = '<button class="btn small" data-friend-accept="' + rel.id + '">Anfrage annehmen</button>';
          else if (rel?.status === "pending") action = '<span class="pill">Anfrage offen</span>';
          return '<article class="friend-card"><div class="friend-avatar">' + esc((p.username || "K").slice(0,1).toUpperCase()) + '</div><div class="friend-copy"><strong>' + personName(p) + '</strong><small>@' + esc(p.username) + '</small></div>' + action + '</article>';
        }).join("") || empty("Keine passenden Spieler gefunden.");
        host.querySelectorAll("[data-friend-send]").forEach(button => button.addEventListener("click", async () => {
          const target = button.dataset.friendSend;
          button.disabled = true;
          try {
            const reverse = (relations || []).find(r => r.requester_id === target && r.addressee_id === currentUser.id && r.status === "pending");
            if (reverse) {
              const { error } = await db.rpc("respond_friend_request", { p_request_id: reverse.id, p_accept: true });
              if (error) throw error;
            } else {
              const existing = relationFor(target);
              if (existing?.status === "declined") {
                const { error: delError } = await db.from("friendships").delete().eq("id", existing.id);
                if (delError) throw delError;
              }
              const { error } = await db.from("friendships").insert({ requester_id: currentUser.id, addressee_id: target, status: "pending" });
              if (error) throw error;
            }
            toast("Freundschaftsanfrage aktualisiert.", "success");
            await renderPage();
          } catch (err) { button.disabled = false; toast(err.message, "error"); }
        }));
      } catch (err) { host.innerHTML = '<div class="notice">' + esc(err.message) + '</div>'; }
    });
    document.querySelectorAll("[data-friend-accept],[data-friend-decline]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const accept = button.hasAttribute("data-friend-accept");
        const id = Number(button.dataset.friendAccept || button.dataset.friendDecline);
        const { error } = await db.rpc("respond_friend_request", { p_request_id: id, p_accept: accept });
        if (error) throw error;
        toast(accept ? "Freund hinzugefügt." : "Anfrage abgelehnt.", "success");
        await renderPage();
      } catch (err) { button.disabled = false; toast(err.message, "error"); }
    }));
    document.querySelectorAll("[data-friend-remove]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Freund wirklich entfernen?")) return;
      const { error } = await db.from("friendships").delete().eq("id", Number(button.dataset.friendRemove));
      if (error) toast(error.message, "error"); else { toast("Freund entfernt.", "success"); await renderPage(); }
    }));
  }

  function wireNotifications() {
    document.querySelectorAll("[data-notification-read]").forEach(button => button.addEventListener("click", async () => {
      const { error } = await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", Number(button.dataset.notificationRead));
      if (error) toast(error.message, "error"); else await renderPage();
    }));
    document.querySelectorAll("[data-notification-open]").forEach(button => button.addEventListener("click", () => go(button.dataset.notificationOpen)));
  }

  function wireMarketWatchlist() {
    document.querySelectorAll("[data-watch-item]").forEach(button => button.addEventListener("click", async () => {
      const itemId = button.dataset.watchItem;
      button.disabled = true;
      try {
        const { data: existing, error: readError } = await db.from("market_watchlist").select("item_id").eq("user_id", currentUser.id).eq("item_id", itemId).maybeSingle();
        if (readError) throw readError;
        const result = existing
          ? await db.from("market_watchlist").delete().eq("user_id", currentUser.id).eq("item_id", itemId)
          : await db.from("market_watchlist").insert({ user_id: currentUser.id, item_id: itemId });
        if (result.error) throw result.error;
        toast(existing ? "Aus Merkliste entfernt." : "Zur Merkliste hinzugefügt.", "success");
        await renderPage();
      } catch (err) { button.disabled = false; toast(err.message, "error"); }
    }));
  }

  function startEventCountdowns() {
    const update = () => document.querySelectorAll("[data-countdown]").forEach(node => {
      const now = Date.now();
      const endAt = node.dataset.countdownEnd ? new Date(node.dataset.countdownEnd).getTime() : null;
      if (Number.isFinite(endAt) && now >= endAt) { node.textContent = "EVENT BEENDET"; return; }
      const diff = new Date(node.dataset.countdown).getTime() - now;
      if (!Number.isFinite(diff)) { node.textContent = "Zeit nicht verfügbar"; return; }
      if (diff <= 0) { node.textContent = "EVENT LÄUFT"; return; }
      const days = Math.floor(diff / 86400000), hours = Math.floor(diff % 86400000 / 3600000), mins = Math.floor(diff % 3600000 / 60000), secs = Math.floor(diff % 60000 / 1000);
      node.textContent = days + "T " + hours + "Std " + mins + "Min " + secs + "Sek";
    });
    update();
    eventCountdownTimer = setInterval(update, 1000);
  }

  function wireExtraMinigames() {
    document.querySelectorAll("[data-extra-game-start]").forEach(button => button.addEventListener("click", () => {
      if (!currentUser) { go("login"); return; }
      const slug = button.dataset.extraGameStart;
      const stage = $("game-stage"), area = $("game-area");
      stage.hidden = false;
      $("game-title").textContent = slug === "click-rush" ? "Click Rush" : "Typing Rush";
      $("game-description").textContent = "Dein Ergebnis zählt für XP, Quests und dein Profil.";
      if (slug === "click-rush") {
        area.innerHTML = '<div class="game-center"><h2 id="click-count">0 Klicks</h2><p id="click-timer" class="muted">10 Sekunden Challenge</p><button class="btn" id="click-start">Start</button><button class="btn" id="click-target" disabled>CLICK!</button></div>';
        let clicks = 0, started = false, remaining = 10;
        const target = $("click-target"), timer = $("click-timer");
        $("click-start").onclick = () => {
          if (started) return;
          started = true; remaining = 10; target.disabled = false; $("click-start").disabled = true;
          const endAt = Date.now() + 10000;
          extraGameTimer = setInterval(async () => {
            remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
            timer.textContent = remaining + " Sekunden übrig";
            if (remaining <= 0) {
              clearInterval(extraGameTimer); extraGameTimer = null; target.disabled = true;
              timer.textContent = "Fertig! " + clicks + " Klicks";
              await saveExtraGame(slug, clicks * 10, 10000, true, { clicks }).catch(err => toast(err.message, "error"));
            }
          }, 100);
        };
        target.onclick = () => { clicks++; $("click-count").textContent = clicks + " Klicks"; };
      } else {
        const words = ["ENDERDRACHE","NETHERITE","KRAKEN","DIAMANTSPITZHACKE","ELYTRA","OBSIDIAN"];
        const word = words[Math.floor(Math.random() * words.length)];
        area.innerHTML = '<div class="game-center"><div class="eyebrow">TYPE THE WORD</div><h2 class="typing-word">' + word + '</h2><form id="typing-form" class="chat-compose"><input class="input" name="answer" autocomplete="off" placeholder="Begriff eintippen …" required><button class="btn">Prüfen</button></form><p class="muted">Schreibe den Begriff exakt ab.</p></div>';
        $("typing-form").onsubmit = async e => {
          e.preventDefault();
          const answer = String(new FormData(e.currentTarget).get("answer") || "").trim().toUpperCase();
          const won = answer === word;
          const score = won ? word.length * 100 : 0;
          area.querySelector("button").disabled = true;
          area.insertAdjacentHTML("beforeend", '<p class="notice">' + (won ? "Richtig! +" + score + " Punkte." : "Leider nicht richtig. Versuche es erneut beim nächsten Lauf.") + '</p>');
          await saveExtraGame(slug, score, null, won, { word, correct: won }).catch(err => toast(err.message, "error"));
        };
      }
    }));
  }

  async function saveExtraGame(slug, score, timeMs, won, metadata) {
    const { data: game, error: gameError } = await db.from("minigames").select("id").eq("slug", slug).single();
    if (gameError) throw gameError;
    const { error } = await db.rpc("economy_submit_minigame_result",{p_slug:slug,p_score:Math.max(0,Math.round(score)),p_time_ms:timeMs??null,p_won:Boolean(won),p_metadata:metadata||{}});
    if (error) toast(error.message, "error");
    else { toast("Ergebnis gespeichert · +" + Math.min(100, 10 + Math.floor(score / 100)) + " XP", "success"); }
  }

  baseWirePage;
})();
