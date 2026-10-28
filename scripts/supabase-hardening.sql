-- Supabase hardening for this app (Supabase used as plain PostgreSQL).
--
-- Supabase publishes the "public" schema through its Data API (PostgREST)
-- to the roles "anon" and "authenticated". This app never uses that API,
-- so lock it out:
--   1. Enable row-level security with NO policies on every app table.
--      Roles other than the table owner then see zero rows. The app connects
--      as the table owner (the role that ran the migrations), which RLS does
--      not restrict, so the app is unaffected.
--   2. Revoke the Data API roles' privileges, now and for future tables.
--
-- Safe to run repeatedly. Re-run after every `prisma migrate deploy` so new
-- tables are covered. Roles that don't exist (e.g. locally) are skipped.

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Verification: every row should show rls_enabled = true.
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
