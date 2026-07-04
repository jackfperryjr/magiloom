-- Avatar service schema.
-- Both tables are written only by the Edge Function (service_role, which
-- bypasses RLS). Enabling RLS with no policies denies all access to anon and
-- authenticated roles, so the client can never read tokens or forge claims.

create table if not exists public.avatar_tokens (
  token      text primary key,
  account    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.avatar_claims (
  name       text primary key,      -- lowercased character name
  account    text not null,         -- owning Simutronics account (first writer)
  created_at timestamptz not null default now()
);

alter table public.avatar_tokens enable row level security;
alter table public.avatar_claims enable row level security;

-- Public, CDN-served bucket for the images. Public = anyone may read; only the
-- service_role (the Edge Function) may write, since no anon write policy exists.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;
