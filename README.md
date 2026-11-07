# KRAKE SMP — Community Portal

The KRAKE SMP portal keeps its existing dark/crimson visual design, Kraken crest, navigation, login, moderation, service pages and admin area. The player hub additions extend the existing application rather than replacing it.

## Stack
- Responsive HTML/CSS/JavaScript frontend
- Supabase Auth, PostgreSQL, RLS, Realtime and Edge Functions
- Username + password login through the `krake-auth` Edge Function
- Role-based permissions, moderation, audit log and maintenance mode

## Player hub features
- Personal dashboard after login with level, XP, KRAKE Coins, quests, achievements, notifications and event previews
- Daily rewards with streak progression and 7 / 14 / 30-day milestone bonuses
- XP and level progression; game results, quests and daily rewards grant XP
- Daily and weekly quests for minigames and community activity
- Nine playable minigames, including Click Rush and Typing Rush; results update player progress and statistics
- Event countdowns
- Expanded player profiles with editable bio and favourite minigame
- Friend search, requests, accept/decline and friend list
- In-app notifications for friend requests, rewards and completed quests
- Existing market price history and request tickets, plus a personal watchlist

## Existing portal features
- Home, Global Chat, Leaderboards, Market, Minigames, Building Service, Team Applications, Events, Profile, Settings, Player Hub, Friends and Notifications
- Minecraft verification request flow with staff approval
- Admin areas: player search, bans, mutes, password reset, verification, applications, private service chats, building orders, market prices, reports, roles, audit log, maintenance and whitelisted admin commands
- Row-level security and server-side permission checks; new player hub tables have RLS policies and least-privilege grants

## Supabase
Project ref: `zrijikvllmotgsixcguc`

The existing Supabase project, Auth users and Storage were retained. The browser config contains only the public Supabase publishable key. Never commit a service-role or secret key. Browser sessions are scoped to `sessionStorage` (not persistent `localStorage`). This static GitHub Pages version does not use HttpOnly cookies; before handling highly sensitive data, move the frontend to a server-rendered deployment with server-managed cookies.

The player hub schema and policies are tracked in `supabase/player-hub.sql`. The deployed Edge Function source remains at `supabase/functions/krake-auth/index.ts`.

## Publish with GitHub Pages
1. Open the repository Settings → Pages.
2. Set Build and deployment source to **GitHub Actions**.
3. Pushes to `main` start the included deployment workflow.
4. GitHub displays the public Pages URL in Settings → Pages after the first successful deploy.

## Remaining setup / limitations
- Leaked-password protection still needs to be enabled in Supabase Auth project settings; the Supabase security advisor flags it as disabled.
- GitHub Pages must be enabled once in repository Settings → Pages → Build and deployment → GitHub Actions.
- Minecraft server live status and actual Minecraft ownership proof require the server-side plugin/API and are not faked by the site.
- Minigame results are browser-submitted starter scores and are not anti-cheat-validated competitive results.
- The Market retains its existing Ingame request-ticket workflow and price history; the new watchlist does not perform automatic Minecraft trades.
- No real-money deposits, withdrawals or cash value are part of the virtual KRAKE Coins.
