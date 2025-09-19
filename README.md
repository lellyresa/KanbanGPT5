# KanbanGPT5

## Auth: Email OTP
- Supabase auth uses email magic links triggered from the login modal.
- In Supabase → Authentication → URL Configuration, add `http://localhost:5173` to the allowed URLs so the magic link redirects back to the Vite dev server.
