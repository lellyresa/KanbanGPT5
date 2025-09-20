# KanbanGPT5

## Auth: Email OTP
- Supabase auth uses email magic links triggered from the login modal.
- In Supabase → Authentication → URL Configuration, add `http://localhost:5173` to the allowed URLs so the magic link redirects back to the Vite dev server.

## Production Notes
- **Environment variables**: set `VITE_SUPABASE_URL` to your Supabase project URL and `VITE_SUPABASE_ANON_KEY` to the public anon key before building. Netlify reads these from the project’s environment tab.
- **Allowed URLs**: in Supabase → Authentication → URL Configuration, add both local (`http://localhost:5173`) and production origins (e.g., `https://your-app.netlify.app`) so email magic links return to the app.
- **SPA redirects**: Netlify should rewrite all routes to `index.html`. The repo ships a `public/_redirects` file (`/* /index.html 200`) that Netlify will pick up automatically; keep the rule if you customize routing.
- **Security headers**: `netlify.toml` sends `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Strict-Transport-Security` for every route.
- **Cache busting**: Vite fingerprinting handles static assets. Redeploy any time you want clients to fetch the latest JS/CSS bundles.
