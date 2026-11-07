# KRAKE Virtual Economy

This document describes the KRAKE virtual economy deployed to the Supabase project and exposed in the portal through `economy.js` / `economy.css`.

## Product rules

- Currency: **KRAKE Coins (KC)**. KC is a closed-loop virtual game currency; it has no cash value and cannot be withdrawn.
- Public exchange catalogue: **309 seeded shares** (50 playful brand-inspired names and 259 fictional KRAKE companies). They are fictional game assets, not real securities or live market quotations.
- Player companies: each account may found one player stock for **2,500 KC**. The founder receives 1,000 shares; share transfers are handled through public player listings.
- Standard exchange fee: **1.5%** per buy/sell order.
- Player listing purchase fee: **2%** charged to the buyer.
- PvP fee: **5%** of the winning pot. Stakes are 10–100,000 KC; draws refund both stakes.
- Dividend claim: one claim per account per day, calculated from the player's holdings and each share's daily dividend basis-point rate.
- Event rewards: users register while an event is active; after the event ends, they can claim the configured `events.config.kc_reward` amount (default 500 KC).
- Achievement unlocks credit the configured `achievements.reward_coins` amount once.
- Event participants register during an active event and claim the configured `events.config.kc_reward` after it ends (default 500 KC).
- Custom rank milestones and one-time KC bonuses are defined in `economy_ranks`.

## Database objects

- `economy_stocks`, `economy_price_history`, `economy_market_clock`
- `economy_holdings`, `economy_trade_history`
- `economy_ranks`, `economy_rank_claims`
- `economy_listings`, `economy_dividend_claims`
- `economy_shop_items`, `economy_purchases`
- `economy_duels`, `economy_quiz_questions`
- `economy_event_entries`

RLS is enabled on all user-facing economy tables. The internal `economy_market_clock` table has no grants to `anon` or `authenticated` (only `postgres` has table privileges); the Supabase table advisor still reports that RLS itself is disabled there. Holdings, transaction history, reward claims, purchases and event entries are owner-scoped. Stock catalog, price history, rank definitions and shop catalog are readable by authenticated users. Economy mutations are performed by authenticated RPCs; clients cannot write balances or share quantities directly.

## RPC surface

- `economy_market_tick()`, `economy_trade(stock_id, shares, side)`
- `economy_claim_dividends()`, `economy_claim_rank()`
- `economy_create_player_stock(name, symbol, sector, description, start_price)`
- `economy_create_listing(stock_id, shares, price)`, `economy_buy_listing(listing_id)`
- `economy_buy_shop(item_id)`, `economy_leaderboard()`
- `economy_create_duel(mode, stake, choice)`, `economy_get_duel_question(duel_id)`, `economy_set_quiz_answer(duel_id, choice)`, `economy_join_duel(duel_id, choice)`, `economy_cancel_duel(duel_id)`
- `economy_join_event(event_id)`, `economy_claim_event(event_id)`

All privileged functions validate `auth.uid()`, use a fixed search path, and keep settlement logic on the database side. Quiz answer keys are not exposed through table SELECT grants; a quiz prompt/answer list is returned without the key.

## Market mechanics

A market tick is rate-limited to once every five minutes and runs when the exchange is opened or an order is submitted. Each active stock receives a bounded random movement with a small order-flow component derived from recent exchange activity. It is a simulated game market, not a live feed.

## PvP modes

- Coinflip
- Dice duel
- Rock-paper-scissors
- Quiz duel (server-held answer key)
- Tournament duel (best-of-three dice rounds)

A duel creator's stake is escrowed when the challenge is created. The second player's stake is escrowed atomically on acceptance. The winner receives the pot less the 5% fee; ties return both stakes. Unaccepted challenges can be cancelled by their creator for a refund.

## Deployment and verification

The Supabase migration history contains the economy migrations beginning with `krake_virtual_economy_exchange_v2` and subsequent player market, PvP, access-policy, reward and bug-fix migrations. The deployed database was smoke-tested inside rolled-back transactions for exchange buy, rank reward, dividends, player-company creation/listing/purchase, shop purchase, PvP settlement, quiz prompts, event rewards and achievement rewards.

The existing Ingame Market and its ticket workflow are unchanged. The new economy is a separate portal route and uses the existing black/crimson visual language.


## Neue Wirtschaftsfeatures (November 2026)
- Spielerunternehmen: bestehende Gründung um serverseitige Firmenkasse erweitert.
- Spieler-Kredite: Kreditangebote, Annahme, Rückzahlung, Storno und fälliger Einzug mit Zinsen.
- Auktionshaus: Aktien werden versteigert; Gebote werden serverseitig reserviert und überbotene Gebote erstattet.
- Markt Crash & Boom: automatische globale oder sektorale Markt-Schocks mit 30-Minuten-Live-Events.
- Alle neuen mutierenden Aktionen laufen über geschützte RPCs; die neuen Tabellen haben RLS.
