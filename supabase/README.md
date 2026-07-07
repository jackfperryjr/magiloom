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

## LOOK portraits (`portrait` function)

Auto-generates a character portrait from the text of a `LOOK <character>` and
stores it once for everyone in a public `portraits` bucket. Generation is
server-side so the Gemini key never ships in the app; a character is generated
by the first person to look at them and cached forever (first-writer-wins).

- **Images** live in the public `portraits` bucket — read from the CDN:
  `GET {SUPABASE_URL}/storage/v1/object/public/portraits/:name`
- **Generation** goes through the `portrait` Edge Function: `POST { name, prompt }`.
  It checks the `avatars` bucket first (an owner upload wins and skips
  generation), then the `portraits` bucket (already generated), then calls Gemini
  and stores the result. Response: `{ ok, source: "owner" | "cache" | "generated" }`.
- **Owner override:** uploaded avatars in the `avatars` bucket always outrank
  generated portraits — resolution precedence in the client is
  upload → owner avatar → generated portrait → identicon.

Deploy (adds to the setup above):

```sh
supabase db push                          # creates the `portraits` bucket (0002)
supabase secrets set GEMINI_API_KEY=<your Google AI Studio key>
supabase functions deploy portrait --no-verify-jwt
```

Optional: `supabase secrets set PORTRAIT_MODEL=gemini-3.1-flash-image` to change
the image model (default `gemini-3.1-flash-lite-image` — "Nano Banana 2 lite").

> The function is public (no per-user auth), so it spends your Gemini key on
> demand. The bucket/cache checks bound this to one call per new character, but if
> abuse is a concern, add a rate limit or a shared client header later.

## Trust model

There is no third-party-verifiable proof that a client controls a DR account, so
this is best-effort by design. The client only offers to publish for a character
the user is logged in as, and a name is locked to the first account that claims
it. Disputes are resolved by editing the `avatar_claims` row directly.
