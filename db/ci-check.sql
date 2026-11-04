DO $$
DECLARE
  actual bigint;
BEGIN
  SELECT count(*) INTO actual
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF actual <> 35 THEN
    RAISE EXCEPTION 'tables: expected 35, got %', actual;
  END IF;

  SELECT count(*) INTO actual FROM pg_views WHERE schemaname = 'public';
  IF actual <> 5 THEN
    RAISE EXCEPTION 'views: expected 5, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  IF actual <> 21 THEN
    RAISE EXCEPTION 'triggers: expected 21, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f';
  IF actual <> 14 THEN
    RAISE EXCEPTION 'functions: expected 14, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'p';
  IF actual <> 1 THEN
    RAISE EXCEPTION 'procedures: expected 1, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF actual <> 118 THEN
    RAISE EXCEPTION 'indexes: expected 118, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF actual <> 14 THEN
    RAISE EXCEPTION 'enums: expected 14, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public' AND c.contype = 'c';
  IF actual <> 72 THEN
    RAISE EXCEPTION 'check_constraints: expected 72, got %', actual;
  END IF;

  SELECT count(*) INTO actual
  FROM pg_tables
  WHERE schemaname = 'public' AND NOT rowsecurity AND tablename <> '_prisma_migrations';
  IF actual <> 0 THEN
    RAISE EXCEPTION 'tables_without_rls: expected 0, got %', actual;
  END IF;

  SELECT count(*) INTO actual FROM food_categories;
  IF actual <> 5 THEN
    RAISE EXCEPTION 'food_categories: expected 5, got %', actual;
  END IF;
END
$$;
