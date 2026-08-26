# Taster

Estimate a dish’s taste profile from native-language recipes.

<img width="572" height="805" alt="Screenshot 2026-08-25 at 9 47 44 PM" src="https://github.com/user-attachments/assets/748ceda1-d294-44b9-8d17-923ab58bb67d" />


## To Run

```bash
cp .env.example .env   # GEMINI_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
npm install
npm test
npm run dev
```

Open http://localhost:3000, enter a dish name, get sweet/sour/salty/spicy/umami/bitter scores.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Gemini origin, search, and recipe parse |
| `TURSO_DATABASE_URL` | yes (app) | libSQL URL (`libsql://…`) |
| `TURSO_AUTH_TOKEN` | yes (app) | Turso DB token (`turso db tokens create taster`) |

`.env` is gitignored. After changing it, restart `npm run dev`. Put the same Turso vars on Vercel. The live catalog is Turso database `taster` (tables `ingredients` and `dishes`). Unit tests use `lib/engine/testdata/ingredients.json` so they do not need Turso.

Agents: see `AGENTS.md`.
