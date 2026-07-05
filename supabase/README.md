# Magiloom avatar service (Supabase)

Stores per-character avatar images and serves them by name.

- **Images** live in a public Storage bucket (`avatars`) — read straight from the
  CDN, no function call.
- **Writes** (register / publish / delete) go through the `avatars` Edge
  Function, which is the only place the `service_role` key lives and which
  enforces first-writer-wins ownership.

Use a **separate Supabase project** from your DR database so the service_role
key's blast radius never touches real data.

## Setup

```sh
# From the repo root, with the Supabase CLI installed.
supabase login
supabase link --project-ref <your-avatar-project-ref>

# Create the tables + public bucket
supabase db push

# Deploy the function with JWT verification OFF (the client uses its own token)
supabase functions deploy avatars --no-verify-jwt
```

## Point the app at it

The project URL is baked into `src/main/avatar-service.ts` as `DEFAULT_SUPABASE_URL`
(it's public, not a secret), so shipped builds just work. To point at a different
project during development or self-hosting, override it:

```
MAGILOOM_SUPABASE_URL=https://<some-other-ref>.supabase.co
```

To disable the shared service entirely, set `DEFAULT_SUPABASE_URL = ''` — everyone
then falls back to deterministic identicons and nothing is published.

## Endpoints (under `/functions/v1/avatars`)

| Method   | Path            | Auth               | Purpose                            |
| -------- | --------------- | ------------------ | ---------------------------------- |
| `POST`   | `/register`     | —                  | Body `{ account }` → `{ token }`.  |
| `PUT`    | `/avatar/:name` | `x-avatar-token`   | Publish/replace. Owner-checked.    |
| `DELETE` | `/avatar/:name` | `x-avatar-token`   | Remove. Owner-checked.             |

Reads are not an endpoint here — fetch the public object directly:
`GET {SUPABASE_URL}/storage/v1/object/public/avatars/:name`

## Trust model

There is no third-party-verifiable proof that a client controls a DR account, so
this is best-effort by design. The client only offers to publish for a character
the user is logged in as, and a name is locked to the first account that claims
it. Disputes are resolved by editing the `avatar_claims` row directly.
