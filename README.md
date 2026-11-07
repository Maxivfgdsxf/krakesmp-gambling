# KRAKE SMP — Community Portal V1

This repository now contains the clean KRAKE SMP website. The previous root application was replaced; the repository and its commit history remain intact.

## Stack
- Responsive HTML/CSS/JavaScript frontend
- Supabase Auth, PostgreSQL, RLS, Realtime and Edge Functions
- Username + password login; no email is sent and no two-factor requirement is enforced
- Role-based permissions, moderation, audit log and maintenance mode

## V1 scope — Updates 1, 4 and 11
- Pages: Home, Global Chat, Leaderboards, Market, Minigames, Building Service, Team Applications, Events, Profile and Settings
- Username/password flow through the `krake-auth` Edge Function
- Minecraft verification request flow with staff approval
- Admin areas: player search, bans, mutes, password reset, verification, applications, private service chats, building orders, market prices, reports, roles, audit log, maintenance and whitelisted admin commands
- Row-level security on all 33 public tables, server-side permission checks, signup/login limits, chat/report/verification limits and audit logging
- Database policies also reject writes from actively banned accounts and muted chat users
- Playable reaction-time test; further minigames and server-linked stats follow in later updates

## Supabase
Project ref: `zrijikvllmotgsixcguc`

The app database schema was rebuilt in the existing Supabase project. The project, Auth users and Storage were retained. The existing account `maxireiknabber` was preserved and given the website `admin` role. It was not given the Minecraft server `owner` role.

The deployed Edge Function source is tracked at `supabase/functions/krake-auth/index.ts`. The former `owner-api-` endpoint has been retired and returns HTTP 410. The browser config contains only the public Supabase publishable key. Never commit a service-role or secret key. Browser sessions are scoped to `sessionStorage` (not persistent `localStorage`). This static GitHub Pages version does not use HttpOnly cookies; before handling highly sensitive data, move the frontend to a server-rendered deployment with server-managed cookies.

## Publish with GitHub Pages
1. Open the repository Settings → Pages.
2. Set Build and deployment source to **GitHub Actions**.
3. Pushes to `main` will start the included deployment workflow.
4. GitHub displays the public Pages URL in Settings → Pages after the first successful deploy.

## First login
Use username `maxireiknabber` and the existing password of the retained Supabase account. New users can create an account in the Login page. New passwords must be at least 12 characters and include uppercase, lowercase, a number and a symbol.

## Not yet finished / later updates
- Leaked-password protection still needs to be enabled in Supabase Auth project settings; the current Supabase security advisor flags it as disabled.
- Enable GitHub Pages once in repository Settings → Pages → Build and deployment → GitHub Actions. The workflow is committed, but a public Pages URL is not available until that setting is enabled and the first deployment succeeds.
- Minecraft server live status and actual Minecraft ownership proof require the server-side plugin/API and are not faked by the site.
- The browser-side reaction challenge is a playable starter, not an anti-cheat-validated competitive result yet.
- The remaining Minigames, full economy/trading actions, seasonal event editor, and complete admin data tooling are follow-on modules, not represented as fully finished here.
- No real-money deposits, withdrawals or cash value are part of the virtual Market.
