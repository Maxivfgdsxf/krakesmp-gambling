# KRAKE SMP — Community Portal V1

This is the clean KRAKE SMP website branch. It is deliberately separate from the repository's existing \`main\` branch.

## Stack
- Static responsive frontend (HTML/CSS/JavaScript)
- Supabase Auth, PostgreSQL, RLS, Realtime and Edge Functions
- Username/password login (username is resolved server-side; no email is sent)
- Roles & permissions (RBAC), admin audit trail, moderation and maintenance

## Included in V1 (Updates 1, 4 and 11)
- Core pages: Home, Global Chat, Leaderboards, Market, Minigames, Building Service, Team Applications, Events, Profile and Settings
- Account system: username/password through the \`krake-auth\` Edge Function
- Minecraft verification requests reviewed by staff
- Admin pages for players, bans, mutes, verification, applications, building orders, market prices, chat reports, roles, audit logs, maintenance and safe whitelisted commands
- RLS policies, server-side permission checks, rate limits and audit logging
- Reaction test is playable; remaining minigames are planned for Update 1.3
- Minecraft live status requires a later server/plugin status API; the UI does not fake an online status

## Supabase
Project ref: \`zrijikvllmotgsixcguc\`

The live database was rebuilt in place without deleting the Supabase project, Auth users or Storage. The existing first account was retained and granted the website \`admin\` role (not the Minecraft server's \`owner\` role). Public tables are RLS protected. The legacy \`owner-api-\` function now returns HTTP 410; use \`krake-auth\`.

The frontend key in \`config.js\` is a Supabase publishable key. Never put a service-role or secret key in this repository.

## GitHub Pages
1. Open repository Settings → Pages.
2. Set Build and deployment source to **GitHub Actions**.
3. Run the workflow from branch \`krake-smp-v1\` (or push a new commit).
4. The Pages URL will appear in Settings → Pages after deployment.

## First login
Use the username and existing password of the retained Supabase account. New members can create accounts from the Login page. New passwords must be at least 12 characters and include uppercase, lowercase, a number and a symbol.

## Important release notes
- Supabase Auth leaked-password protection is still a project-level setting and is not enabled by this code.
- The Minecraft server status and plugin/API verification are not wired until the Minecraft-side API exists.
- Payments, real-money deposits and withdrawals are intentionally not part of this website.
