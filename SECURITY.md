# Security

Quorum handles board conversations, company context, and model credentials. Treat a deployment as
production infrastructure, not a demo.

## Reporting

Email **admin@desmond-digital.com** with a description, reproduction steps, and impact. Do not open
a public issue for a vulnerability. Expect an acknowledgement within two business days.

## What the app does to protect data

- Sessions are server-side, signed with `SESSION_SECRET`, `httpOnly`, and scoped to the API.
- User-supplied OpenRouter keys are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`); the API
  returns masked keys only.
- WebSocket subscriptions are authenticated and scoped to the conversation owner.
- Model-generated HTML artifacts are sanitised with DOMPurify before rendering. Vega specs are
  inline-only; external chart resources are blocked by the renderer loader.
- Uploaded files are size-limited and served from a dedicated route with no directory listing.
- Stripe webhooks are signature-verified before any tier change.

## Deployment requirements

- Set long random `SESSION_SECRET` and `ENCRYPTION_KEY` values (`openssl rand -hex 32` /
  `openssl rand -base64 32`).
- Serve over HTTPS; set `ALLOWED_ORIGIN` to the exact origin.
- Use a dedicated database role with access only to the Quorum database.
- Keep `.env` out of the image and out of git. The provided `.gitignore` enforces this.
- If you enable self-serve registration on the public internet, put rate limiting or an identity
  proxy in front of `/api/register` and `/api/login`.

## Known limits

- Directors are language models. They can be wrong, and prompt injection through uploaded
  documents or fetched pages is possible. The board is designed to separate advice from verified
  fact, not to guarantee correctness.
- The app does not encrypt the database at rest; use your provider's disk encryption.
- No SOC 2 / ISO 27001 claim is made. Enterprise deployments should complete their own review.
