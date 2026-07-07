-- Shared AI-generated LOOK portraits.
-- Public, CDN-served bucket keyed by lowercased character name. Public = anyone
-- may read; only the service_role (the `portrait` Edge Function) may write, since
-- no anon write policy exists. First-writer-wins is enforced by the function
-- (existence check + non-upserting upload), so no ownership table is needed —
-- owner-uploaded avatars live in the separate `avatars` bucket and outrank these.
insert into storage.buckets (id, name, public)
values ('portraits', 'portraits', true)
on conflict (id) do update set public = excluded.public;
