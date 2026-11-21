-- Calculators created by the admin. The app talks to this table only from
-- server code using the service-role key, so RLS is on with no policies:
-- the public anon key cannot read or write anything.

create table if not exists public.calculators (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  description text not null default '',
  currency text not null default '',
  schema jsonb not null,
  source_filename text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calculators enable row level security;

-- Newer Supabase projects don't auto-grant API roles on new tables.
-- Only the server-side service_role gets access; anon/authenticated get nothing.
grant select, insert, update, delete on public.calculators to service_role;
revoke all on public.calculators from anon, authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists calculators_touch on public.calculators;
create trigger calculators_touch before update on public.calculators
for each row execute function public.touch_updated_at();
