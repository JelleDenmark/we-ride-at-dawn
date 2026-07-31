-- Nightly PvP league — server-side tuning config.
--
-- One small key/value table so league levers can be retuned LIVE (a SQL
-- `update`) without a client deploy. The first lever is `loss_consolation`:
-- the flat scrap a duel loser is paid per loss (the anti-snowball catch-up —
-- see packages/core/src/pvp.ts `consolationScrap`). The amount is admitted
-- guesswork until a full week runs, which is exactly why it lives here and not
-- in a shipped client constant.
--
-- The client reads this anon (same public-read posture as the other pvp_*
-- tables); there is NO anon write path — the owner edits values via the SQL
-- editor. `pvp_config` is channel-agnostic (NOT dev- prefixed like season ids):
-- one knob governs dev and prod alike.
--
-- DO NOT RUN AUTOMATICALLY. Apply by hand (SQL editor / CLI) against the live
-- project before the loss-consolation client code ships. Inert until applied.
-- Re-run safe: `create table if not exists` + `on conflict do nothing` seed.
--
-- To retune the lever later (no deploy needed):
--   update public.pvp_config
--      set value = to_jsonb(<n>::int), updated_at = now()
--    where key = 'loss_consolation';

create table if not exists public.pvp_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed the loss-consolation lever with LOSS_CONSOLATION_DEFAULT (6) from
-- packages/core/src/pvp.ts. `do nothing` so re-running never clobbers a value
-- the owner has since tuned live.
insert into public.pvp_config (key, value)
values ('loss_consolation', to_jsonb(6))
on conflict (key) do nothing;

grant select on public.pvp_config to anon;
alter table public.pvp_config enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pvp_config'
      and policyname = 'pvp config public read'
  ) then
    create policy "pvp config public read"
      on public.pvp_config for select to anon using (true);
  end if;
end
$$;
