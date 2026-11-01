-- Net Worth Tracker — one-time Supabase setup.
-- Run this whole file once in your own project's SQL editor.
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> below with your own values first
-- (find both in Supabase → Project Settings → API). Never commit them.

-- 0) Main state table — the entire app store lives in one JSON row per install
--    (id = 'default'). Without this table every page load 502s on /api/state.
create table if not exists public.app_state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only the service_role (used by the Next.js API routes) may read or write it.
-- RLS on with zero policies blocks anon/authenticated entirely; service_role
-- bypasses RLS. This is what keeps your figures off the public internet.
alter table public.app_state enable row level security;

-- 1) Snapshot table — its own time-series, separate from the app_state blob so
--    the 60s blob writes can never clobber cron-written points.
create table if not exists public.networth_snapshots (
  id              uuid primary key default gen_random_uuid(),
  snap_date       date not null unique,           -- Europe/Athens calendar day
  base_currency   text not null,
  total_net_worth double precision not null,
  by_category     jsonb not null,
  assets          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- Lock the table down: only the service_role (used by the API + Edge Function)
-- can touch it. RLS on with no policies blocks anon/authenticated entirely;
-- service_role bypasses RLS.
alter table public.networth_snapshots enable row level security;

-- 2) Extensions for the scheduled HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Schedule: hourly. The Edge Function is idempotent per Athens day, so the
--    first run after local midnight records the day and the rest no-op. Hourly
--    (not daily) makes it self-healing if a run is missed.
--    Requires the daily-snapshot Edge Function to be deployed first:
--      supabase functions deploy daily-snapshot
--    NOTE: replace <PROJECT_REF> and <SERVICE_ROLE_KEY> before running.
select cron.unschedule('daily-networth-snapshot')
where exists (select 1 from cron.job where jobname = 'daily-networth-snapshot');

select cron.schedule(
  'daily-networth-snapshot',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:  select * from cron.job;
-- History:  select * from cron.job_run_details order by start_time desc limit 10;
