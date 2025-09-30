# KanbanGPT5

## Auth: Email OTP

- Supabase auth uses email magic links triggered from the login modal.
- In Supabase → Authentication → URL Configuration, add `http://localhost:5173` to the allowed URLs so the magic link redirects back to the Vite dev server.

## Production Notes

- **Environment variables**: set `VITE_SUPABASE_URL` to your Supabase project URL and `VITE_SUPABASE_ANON_KEY` to the public anon key before building. Netlify reads these from the project’s environment tab. The app now reads credentials exclusively from Vite env variables, so there is no longer a `public/config.js` override—configure values per environment instead of checking them into git.
- **Theme**: the UI ships in a single dark mode that mirrors the production mock. You can still provide a `data-theme="light"` override if you want to explore alternatives, but there is no light palette maintained in this repo.
- **Allowed URLs**: in Supabase → Authentication → URL Configuration, add both local (`http://localhost:5173`) and production origins (e.g., `https://your-app.netlify.app`) so email magic links return to the app.
- **SPA redirects**: Netlify should rewrite all routes to `index.html`. The repo ships a `public/_redirects` file (`/* /index.html 200`) that Netlify will pick up automatically; keep the rule if you customize routing.
- **Security headers**: `netlify.toml` sends `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Strict-Transport-Security` for every route.
- **Cache busting**: Vite fingerprinting handles static assets. Redeploy any time you want clients to fetch the latest JS/CSS bundles.
- **Database schema**: run the SQL migrations in `supabase/migrations/` (including `202502141200_board_core.sql`) to provision the `projects`, `columns`, `tasks`, `pomodoro_settings`, and `board_states` tables with the required row-level security policies. Apply them via the Supabase CLI (`supabase db push`) or the SQL editor before deploying the frontend.
- **Design tokens**: global tokens live in `src/ui/theme.css` and power typography, color, spacing, and motion via CSS custom properties. Import it before any component styles to ensure overrides cascade correctly.
- **Type safety**: the project ships with `tsconfig.json` and `env.d.ts`. Run `npm run typecheck` (wired into CI) to catch regressions before shipping.

## Tooling & Quality Gates

- `npm run lint` — ESLint with TypeScript + import rules.
- `npm run format:check` / `npm run format` — Prettier for consistent formatting.
- `npm run test` — Vitest unit tests (see `src/utils/`). Add new tests alongside features to keep coverage meaningful.
- `npm run typecheck` — Type-only validation via `tsc --noEmit`.
- `npm run build` — Production bundle using Vite.

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint, formatting checks, typecheck, tests, and the production build on each push or PR to `main`.

## Deployment Checklist

1. Ensure Supabase migrations are applied (`supabase db push` or SQL editor run of everything inside `supabase/migrations/`).
2. Add the Supabase env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) to Netlify or your hosting provider.
3. Run the CI pipeline (or `npm run lint && npm run format:check && npm run typecheck && npm run test && npm run build`) locally before deploying.
