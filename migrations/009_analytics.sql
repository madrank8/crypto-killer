-- 009_analytics.sql
-- Self-hosted traffic analytics + Google Search Console sync.
--
-- analytics_events: raw first-party events (pageviews + outbound clicks)
--   written by /api/track (service_role). RLS enabled with NO policies:
--   anon key can neither read nor write; service_role bypasses RLS.
-- gsc_daily: daily Search Console rollups upserted by /api/cron/gsc-sync.
-- RPCs: aggregate readers called by /api/admin/analytics/* (POST → service_role
--   in lib/supabase.js, so RLS never blocks them).

-- ─── Raw events ───────────────────────────────────────────────────────────
create table if not exists analytics_events (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null default now(),
  event_type    text not null default 'pageview' check (event_type in ('pageview', 'click')),
  path          text not null,
  locale        text,
  referrer      text,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  -- sha256(daily_salt + ip + ua) — rotates daily, no PII stored
  visitor_hash  text not null,
  -- client-generated per-tab session id, hashed server-side
  session_hash  text,
  country       text,
  device        text check (device in ('desktop', 'mobile', 'tablet') or device is null),
  -- click events: outbound href
  target        text
);

create index if not exists idx_analytics_events_ts on analytics_events (ts desc);
create index if not exists idx_analytics_events_type_ts on analytics_events (event_type, ts desc);
create index if not exists idx_analytics_events_path_ts on analytics_events (path, ts desc);

alter table analytics_events enable row level security;

-- ─── GSC daily rollups ────────────────────────────────────────────────────
create table if not exists gsc_daily (
  date        date not null,
  dimension   text not null check (dimension in ('page', 'query')),
  key         text not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         numeric,
  position    numeric,
  synced_at   timestamptz not null default now(),
  primary key (date, dimension, key)
);

create index if not exists idx_gsc_daily_dim_date on gsc_daily (dimension, date desc);

alter table gsc_daily enable row level security;

-- ─── Aggregate RPCs (invoker security; service_role bypasses RLS) ─────────

-- Daily pageviews / unique visitors / sessions for the last p_days days.
create or replace function analytics_timeseries(p_days integer default 30)
returns table (day date, pageviews bigint, visitors bigint, sessions bigint)
language sql stable as $$
  select
    (ts at time zone 'utc')::date as day,
    count(*) filter (where event_type = 'pageview') as pageviews,
    count(distinct visitor_hash) filter (where event_type = 'pageview') as visitors,
    count(distinct session_hash) filter (where event_type = 'pageview') as sessions
  from analytics_events
  where ts >= now() - make_interval(days => p_days)
  group by 1
  order by 1
$$;

-- Current-window vs previous-window totals (for delta chips).
create or replace function analytics_summary(p_days integer default 30)
returns json
language sql stable as $$
  with cur as (
    select
      count(*) filter (where event_type = 'pageview') as pageviews,
      count(distinct visitor_hash) filter (where event_type = 'pageview') as visitors,
      count(distinct session_hash) filter (where event_type = 'pageview') as sessions,
      count(*) filter (where event_type = 'click') as clicks
    from analytics_events
    where ts >= now() - make_interval(days => p_days)
  ),
  prev as (
    select
      count(*) filter (where event_type = 'pageview') as pageviews,
      count(distinct visitor_hash) filter (where event_type = 'pageview') as visitors,
      count(distinct session_hash) filter (where event_type = 'pageview') as sessions,
      count(*) filter (where event_type = 'click') as clicks
    from analytics_events
    where ts >= now() - make_interval(days => p_days * 2)
      and ts <  now() - make_interval(days => p_days)
  )
  select json_build_object(
    'current', (select row_to_json(cur) from cur),
    'previous', (select row_to_json(prev) from prev)
  )
$$;

-- Top-N breakdown by a whitelisted dimension.
create or replace function analytics_top(
  p_days integer default 30,
  p_dim text default 'path',
  p_limit integer default 10
)
returns table (key text, pageviews bigint, visitors bigint)
language plpgsql stable as $$
begin
  if p_dim not in ('path', 'referrer_host', 'country', 'device', 'locale', 'utm_source') then
    raise exception 'analytics_top: invalid dimension %', p_dim;
  end if;
  return query execute format(
    $q$
      select
        coalesce(nullif(%I::text, ''), '(none)') as key,
        count(*)::bigint as pageviews,
        count(distinct visitor_hash)::bigint as visitors
      from analytics_events
      where event_type = 'pageview'
        and ts >= now() - make_interval(days => $1)
      group by 1
      order by 2 desc
      limit $2
    $q$, p_dim)
  using p_days, p_limit;
end
$$;

-- Top outbound click targets (CTA performance).
create or replace function analytics_top_clicks(p_days integer default 30, p_limit integer default 10)
returns table (target text, path text, clicks bigint)
language sql stable as $$
  select target, path, count(*) as clicks
  from analytics_events
  where event_type = 'click'
    and ts >= now() - make_interval(days => p_days)
  group by 1, 2
  order by 3 desc
  limit p_limit
$$;
