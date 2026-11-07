-- KRAKE SMP Player Hub feature schema.
-- Safe to re-run. New public tables are RLS-protected and receive only the grants needed by the UI.

create schema if not exists private;
alter table public.profiles add column if not exists bio text, add column if not exists favorite_game text, add column if not exists profile_banner_url text;

create table if not exists public.player_progress(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 xp bigint not null default 0 check(xp>=0), level integer not null default 1 check(level>=1),
 current_streak integer not null default 0 check(current_streak>=0),
 longest_streak integer not null default 0 check(longest_streak>=0), last_daily_claim date,
 updated_at timestamptz not null default now()
);
create table if not exists public.daily_reward_claims(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 claim_date date not null default current_date, streak integer not null,
 xp_reward integer not null, coin_reward bigint not null, created_at timestamptz not null default now(),
 unique(user_id,claim_date)
);
create table if not exists public.quest_templates(
 id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null,
 description text not null, recurrence text not null check(recurrence in('daily','weekly')),
 goal_type text not null check(goal_type in('play_games','win_games','score_points','chat_messages')),
 target_count integer not null check(target_count>0), xp_reward integer not null default 0 check(xp_reward>=0),
 coin_reward bigint not null default 0 check(coin_reward>=0), active boolean not null default true
);
create table if not exists public.player_quests(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 quest_id uuid not null references public.quest_templates(id) on delete cascade,
 period_start date not null, progress integer not null default 0 check(progress>=0),
 completed_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,quest_id,period_start)
);
create table if not exists public.achievements(
 id uuid primary key default gen_random_uuid(), slug text not null unique,
 title text not null, description text not null, icon text not null default '🏆', active boolean not null default true
);
create table if not exists public.user_achievements(
 user_id uuid not null references public.profiles(id) on delete cascade,
 achievement_id uuid not null references public.achievements(id) on delete cascade,
 unlocked_at timestamptz not null default now(), primary key(user_id,achievement_id)
);
create table if not exists public.friendships(
 id bigint generated always as identity primary key,
 requester_id uuid not null references public.profiles(id) on delete cascade,
 addressee_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in('pending','accepted','declined')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(requester_id<>addressee_id), unique(requester_id,addressee_id)
);
create table if not exists public.notifications(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 kind text not null, title text not null, body text not null default '',
 target_route text not null default 'dashboard', read_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.market_watchlist(
 user_id uuid not null references public.profiles(id) on delete cascade,
 item_id uuid not null references public.market_items(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,item_id)
);

create index if not exists idx_friendships_addressee_status on public.friendships(addressee_id,status);
create index if not exists idx_friendships_requester_status on public.friendships(requester_id,status);
create index if not exists idx_notifications_user_created on public.notifications(user_id,created_at desc);
create index if not exists idx_notifications_actor_id on public.notifications(actor_id);
create index if not exists idx_player_quests_user_period on public.player_quests(user_id,period_start);
create index if not exists idx_player_quests_quest_id on public.player_quests(quest_id);
create index if not exists idx_user_achievements_achievement_id on public.user_achievements(achievement_id);
create index if not exists idx_market_watchlist_item on public.market_watchlist(item_id);

alter table public.player_progress enable row level security;
alter table public.daily_reward_claims enable row level security;
alter table public.quest_templates enable row level security;
alter table public.player_quests enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.friendships enable row level security;
alter table public.notifications enable row level security;
alter table public.market_watchlist enable row level security;

drop policy if exists "progress visible to everyone" on public.player_progress;
create policy "progress visible to everyone" on public.player_progress for select to anon,authenticated using(true);
drop policy if exists "daily claims visible to owner" on public.daily_reward_claims;
create policy "daily claims visible to owner" on public.daily_reward_claims for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "quest templates public read" on public.quest_templates;
create policy "quest templates public read" on public.quest_templates for select to anon,authenticated using(active=true);
drop policy if exists "player quests owner read" on public.player_quests;
create policy "player quests owner read" on public.player_quests for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "achievements public read" on public.achievements;
create policy "achievements public read" on public.achievements for select to anon,authenticated using(active=true);
drop policy if exists "user achievements public read" on public.user_achievements;
create policy "user achievements public read" on public.user_achievements for select to anon,authenticated using(true);
drop policy if exists "friendships participants read" on public.friendships;
create policy "friendships participants read" on public.friendships for select to authenticated using((select auth.uid()) in(requester_id,addressee_id));
drop policy if exists "friendships self request" on public.friendships;
create policy "friendships self request" on public.friendships for insert to authenticated with check((select auth.uid())=requester_id and status='pending');
drop policy if exists "friendships recipient respond" on public.friendships;
create policy "friendships recipient respond" on public.friendships for update to authenticated using((select auth.uid())=addressee_id and status='pending') with check((select auth.uid())=addressee_id and status in('accepted','declined'));
drop policy if exists "friendships participants delete" on public.friendships;
create policy "friendships participants delete" on public.friendships for delete to authenticated using((select auth.uid()) in(requester_id,addressee_id));
drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists "market watchlist own all" on public.market_watchlist;
create policy "market watchlist own all" on public.market_watchlist for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

grant select on public.player_progress to anon,authenticated;
grant select on public.daily_reward_claims to authenticated;
grant select on public.quest_templates to anon,authenticated;
grant select on public.player_quests to authenticated;
grant select on public.achievements to anon,authenticated;
grant select on public.user_achievements to anon,authenticated;
grant select,insert,update,delete on public.friendships to authenticated;
grant select,update on public.notifications to authenticated;
grant select,insert,delete on public.market_watchlist to authenticated;
grant usage,select on sequence public.friendships_id_seq to authenticated;
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
revoke update on public.friendships from authenticated;
grant update(status,updated_at) on public.friendships to authenticated;

insert into public.quest_templates(slug,title,description,recurrence,goal_type,target_count,xp_reward,coin_reward) values
('daily_play_1','Warm-up','Spiele 1 Minigame.','daily','play_games',1,40,75),
('daily_win_1','Siegesserie','Gewinne 1 Minigame.','daily','win_games',1,60,100),
('daily_score_500','Punktejäger','Erreiche insgesamt 500 Punkte in Minigames.','daily','score_points',500,80,125),
('daily_chat_1','Community-Stimme','Schreibe eine Nachricht im Globalen Chat.','daily','chat_messages',1,25,50),
('weekly_play_10','Stammspieler','Spiele 10 Minigames.','weekly','play_games',10,250,500),
('weekly_win_5','Champion','Gewinne 5 Minigames.','weekly','win_games',5,300,650)
on conflict(slug) do nothing;
insert into public.achievements(slug,title,description,icon) values
('first_game','Erstes Match','Schließe dein erstes Minigame ab.','🎮'),
('games_10','Warmgelaufen','Spiele 10 Minigames.','⚡'),
('wins_10','Sieger','Gewinne 10 Minigames.','🏆'),
('xp_1000','Aufsteiger','Sammle 1.000 XP.','🌟'),
('streak_7','Eine Woche dabei','Erreiche eine 7-Tage-Login-Serie.','🔥'),
('first_friend','Nicht allein','Füge deinen ersten Freund hinzu.','🤝')
on conflict(slug) do nothing;
insert into public.player_progress(user_id) select id from public.profiles on conflict(user_id) do nothing;
insert into public.user_balances(user_id,balance) select id,0 from public.profiles on conflict(user_id) do nothing;

create or replace function private.bootstrap_player_features()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 insert into public.player_progress(user_id) values(new.id) on conflict(user_id) do nothing;
 insert into public.user_balances(user_id,balance) values(new.id,0) on conflict(user_id) do nothing;
 return new;
end; $$;
drop trigger if exists profile_bootstrap_features on public.profiles;
create trigger profile_bootstrap_features after insert on public.profiles for each row execute function private.bootstrap_player_features();

create or replace function private.ensure_player_quests()
returns void language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=auth.uid(); begin
 if v_user is null then raise exception 'Anmeldung erforderlich'; end if;
 insert into public.player_quests(user_id,quest_id,period_start)
 select v_user,q.id,case when q.recurrence='daily' then current_date else date_trunc('week',current_date)::date end
 from public.quest_templates q where q.active on conflict(user_id,quest_id,period_start) do nothing;
end; $$;

create or replace function private.claim_daily_reward()
returns jsonb language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=auth.uid(); v_today date:=current_date; v_last date; v_streak integer; v_xp integer; v_coins bigint; v_total bigint; v_new_xp bigint; begin
 if v_user is null then raise exception 'Anmeldung erforderlich'; end if;
 insert into public.player_progress(user_id) values(v_user) on conflict(user_id) do nothing;
 select last_daily_claim,current_streak into v_last,v_streak from public.player_progress where user_id=v_user for update;
 if v_last=v_today then raise exception 'Deine Tagesbelohnung hast du heute bereits abgeholt.'; end if;
 v_streak:=case when v_last=v_today-1 then v_streak+1 else 1 end;
 v_xp:=50+least(v_streak,30)*5; v_coins:=100+least(v_streak,30)*20;
 insert into public.daily_reward_claims(user_id,claim_date,streak,xp_reward,coin_reward) values(v_user,v_today,v_streak,v_xp,v_coins);
 update public.player_progress set current_streak=v_streak,longest_streak=greatest(longest_streak,v_streak),last_daily_claim=v_today,xp=xp+v_xp,level=floor(sqrt((xp+v_xp)::numeric/100))::integer+1,updated_at=now() where user_id=v_user returning xp into v_new_xp;
 update public.user_balances set balance=balance+v_coins,updated_at=now() where user_id=v_user returning balance into v_total;
 if not found then insert into public.user_balances(user_id,balance) values(v_user,v_coins) returning balance into v_total; end if;
 insert into public.currency_transactions(user_id,amount,balance_after,transaction_type,description) values(v_user,v_coins,v_total,'daily_reward','Tagesbelohnung · Serie '||v_streak);
 insert into public.notifications(user_id,kind,title,body,target_route) values(v_user,'daily_reward','Tagesbelohnung erhalten','+'||v_xp||' XP und +'||v_coins||' Coins','dashboard');
 insert into public.user_achievements(user_id,achievement_id) select v_user,id from public.achievements where (slug='streak_7' and v_streak>=7) or (slug='xp_1000' and v_new_xp>=1000) on conflict do nothing;
 return jsonb_build_object('streak',v_streak,'xp',v_xp,'coins',v_coins,'total_xp',v_new_xp);
end; $$;

create or replace function private.respond_friend_request(p_request_id bigint,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare v_user uuid:=auth.uid(); v_row public.friendships; begin
 if v_user is null then raise exception 'Anmeldung erforderlich'; end if;
 update public.friendships set status=case when p_accept then 'accepted' else 'declined' end,updated_at=now()
 where id=p_request_id and addressee_id=v_user and status='pending' returning * into v_row;
 if not found then raise exception 'Freundschaftsanfrage nicht gefunden oder bereits bearbeitet.'; end if;
 if p_accept then
  insert into public.notifications(user_id,actor_id,kind,title,body,target_route) values(v_row.requester_id,v_user,'friend_accepted','Freundschaft bestätigt','Deine Anfrage wurde angenommen.','friends');
  insert into public.user_achievements(user_id,achievement_id)
  select who,id from public.achievements cross join (values(v_user),(v_row.requester_id)) as users(who)
  where slug='first_friend' on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true,'status',v_row.status);
end; $$;

create or replace function private.notify_friend_request()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 insert into public.notifications(user_id,actor_id,kind,title,body,target_route) values(new.addressee_id,new.requester_id,'friend_request','Neue Freundschaftsanfrage','Ein Spieler möchte dich als Freund hinzufügen.','friends');
 return new;
end; $$;
drop trigger if exists friendships_notify_request on public.friendships;
create trigger friendships_notify_request after insert on public.friendships for each row execute function private.notify_friend_request();

create or replace function private.update_progress_after_game()
returns trigger language plpgsql security definer set search_path=''
as $$ declare v_xp integer:=least(100,10+greatest(0,coalesce(new.score,0)/100)::integer); q record; v_inc integer; v_games integer; v_wins integer; v_total_xp bigint; begin
 insert into public.player_progress(user_id,xp,level) values(new.user_id,v_xp,floor(sqrt(v_xp::numeric/100))::integer+1)
 on conflict(user_id) do update set xp=public.player_progress.xp+excluded.xp,level=floor(sqrt((public.player_progress.xp+excluded.xp)::numeric/100))::integer+1,updated_at=now();
 insert into public.player_statistics(user_id,games_played,wins,losses,best_time_ms,total_score,rating,updated_at)
 values(new.user_id,1,case when new.won then 1 else 0 end,case when new.won then 0 else 1 end,new.time_ms,coalesce(new.score,0),1000,now())
 on conflict(user_id) do update set games_played=public.player_statistics.games_played+1,wins=public.player_statistics.wins+case when new.won then 1 else 0 end,losses=public.player_statistics.losses+case when new.won then 0 else 1 end,best_time_ms=case when new.time_ms is null then public.player_statistics.best_time_ms when public.player_statistics.best_time_ms is null then new.time_ms else least(public.player_statistics.best_time_ms,new.time_ms) end,total_score=public.player_statistics.total_score+coalesce(new.score,0),updated_at=now();
 for q in select pq.id,pq.progress,qt.target_count,qt.goal_type,qt.xp_reward,qt.coin_reward from public.player_quests pq join public.quest_templates qt on qt.id=pq.quest_id where pq.user_id=new.user_id and pq.completed_at is null and pq.period_start=case when qt.recurrence='daily' then current_date else date_trunc('week',current_date)::date end loop
  v_inc:=case when q.goal_type='play_games' then 1 when q.goal_type='win_games' and new.won then 1 when q.goal_type='score_points' then greatest(0,coalesce(new.score,0)) else 0 end;
  if v_inc>0 then
   update public.player_quests set progress=least(q.target_count,q.progress+v_inc),completed_at=case when q.progress+v_inc>=q.target_count then now() else null end where id=q.id;
   if q.progress+v_inc>=q.target_count then
    update public.player_progress set xp=xp+q.xp_reward,level=floor(sqrt((xp+q.xp_reward)::numeric/100))::integer+1,updated_at=now() where user_id=new.user_id;
    if q.coin_reward>0 then
     insert into public.user_balances(user_id,balance) values(new.user_id,q.coin_reward) on conflict(user_id) do update set balance=public.user_balances.balance+excluded.balance,updated_at=now();
     insert into public.currency_transactions(user_id,amount,balance_after,transaction_type,description) select new.user_id,q.coin_reward,balance,'quest_reward','Quest abgeschlossen' from public.user_balances where user_id=new.user_id;
    end if;
    insert into public.notifications(user_id,kind,title,body,target_route) values(new.user_id,'quest_complete','Quest abgeschlossen','Eine Quest ist abgeschlossen. Deine Belohnung wurde gutgeschrieben.','dashboard');
   end if;
  end if;
 end loop;
 select count(*),count(*) filter(where won) into v_games,v_wins from public.minigame_results where user_id=new.user_id;
 select xp into v_total_xp from public.player_progress where user_id=new.user_id;
 insert into public.user_achievements(user_id,achievement_id) select new.user_id,a.id from public.achievements a where (a.slug='first_game' and v_games>=1) or (a.slug='games_10' and v_games>=10) or (a.slug='wins_10' and v_wins>=10) or (a.slug='xp_1000' and v_total_xp>=1000) on conflict do nothing;
 return new;
end; $$;
drop trigger if exists minigame_progress_award on public.minigame_results;
create trigger minigame_progress_award after insert on public.minigame_results for each row execute function private.update_progress_after_game();

create or replace function private.update_chat_quest()
returns trigger language plpgsql security definer set search_path=''
as $$ declare q record; v_balance bigint; begin
 for q in select pq.id,pq.progress,qt.target_count,qt.xp_reward,qt.coin_reward from public.player_quests pq join public.quest_templates qt on qt.id=pq.quest_id where pq.user_id=new.user_id and qt.goal_type='chat_messages' and pq.completed_at is null and pq.period_start=current_date loop
  update public.player_quests set progress=least(q.target_count,q.progress+1),completed_at=case when q.progress+1>=q.target_count then now() else null end where id=q.id;
  if q.progress+1>=q.target_count then
   update public.player_progress set xp=xp+q.xp_reward,level=floor(sqrt((xp+q.xp_reward)::numeric/100))::integer+1,updated_at=now() where user_id=new.user_id;
   insert into public.user_balances(user_id,balance) values(new.user_id,q.coin_reward) on conflict(user_id) do update set balance=public.user_balances.balance+excluded.balance,updated_at=now();
   select balance into v_balance from public.user_balances where user_id=new.user_id;
   insert into public.currency_transactions(user_id,amount,balance_after,transaction_type,description) values(new.user_id,q.coin_reward,v_balance,'quest_reward','Community-Quest abgeschlossen');
   insert into public.notifications(user_id,kind,title,body,target_route) values(new.user_id,'quest_complete','Quest abgeschlossen','Community-Stimme abgeschlossen.','dashboard');
  end if;
 end loop;
 return new;
end; $$;
drop trigger if exists chat_quest_progress on public.chat_messages;
create trigger chat_quest_progress after insert on public.chat_messages for each row execute function private.update_chat_quest();

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on function private.ensure_player_quests() to authenticated;
grant execute on function private.claim_daily_reward() to authenticated;
grant execute on function private.respond_friend_request(bigint,boolean) to authenticated;

create or replace function public.ensure_player_quests()
returns void language sql security invoker set search_path=''
as $$ select private.ensure_player_quests(); $$;
create or replace function public.claim_daily_reward()
returns jsonb language sql security invoker set search_path=''
as $$ select private.claim_daily_reward(); $$;
create or replace function public.respond_friend_request(p_request_id bigint,p_accept boolean)
returns jsonb language sql security invoker set search_path=''
as $$ select private.respond_friend_request(p_request_id,p_accept); $$;
revoke all on function public.ensure_player_quests() from public,anon;
revoke all on function public.claim_daily_reward() from public,anon;
revoke all on function public.respond_friend_request(bigint,boolean) from public,anon;
grant execute on function public.ensure_player_quests() to authenticated;
grant execute on function public.claim_daily_reward() to authenticated;
grant execute on function public.respond_friend_request(bigint,boolean) to authenticated;

insert into public.minigames(slug,name,description,active) values
('click-rush','Click Rush','Klicke in 10 Sekunden so oft du kannst.',true),
('typing-rush','Typing Rush','Tippe den angezeigten Minecraft-Begriff fehlerfrei.',true)
on conflict(slug) do nothing;
