-- Supabase security hardening: enable RLS on all public tables.
-- Fixes Supabase Advisor alerts: rls_disabled_in_public, sensitive_columns_exposed.
--
-- This app accesses Postgres via backend DATABASE_URL (server-side), not Supabase
-- PostgREST anon/authenticated clients. Enabling RLS with no permissive policies
-- blocks anon/authenticated API access while keeping server-side access working
-- for roles that bypass RLS (e.g. Supabase postgres/service_role).
--
-- IMPORTANT: Do NOT add FORCE ROW LEVEL SECURITY unless you have confirmed your
-- backend DB role bypasses RLS or you have added explicit policies for it.

ALTER TABLE IF EXISTS public.app_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.schema_migrations ENABLE ROW LEVEL SECURITY;

-- Optional defense-in-depth (ONLY after confirming backend role behavior):
-- ALTER TABLE IF EXISTS public.<table> FORCE ROW LEVEL SECURITY;

-- No permissive policies are created intentionally.
-- Add explicit policies only if you need Supabase client (anon/authenticated) access.