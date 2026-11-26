-- Agent Hosting Protocol multi-host coordination (PostgreSQL 17).
-- Preserves every existing session, resource, registration and work row.
-- Stop every pre-0005 host before applying: the preflight refuses to continue
-- while one still holds the store, and afterwards a pre-0005 binary can no
-- longer acquire it (see ahp_guard_host_state).
BEGIN;

LOCK TABLE host_state, sessions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  -- A pre-0005 owner retains this database-local, relation-specific session lock.
  IF NOT pg_try_advisory_xact_lock('host_state'::regclass::oid::bigint) THEN
    RAISE EXCEPTION '0005 requires every existing host of this store to be stopped. No records were changed.';
  END IF;
  IF (SELECT count(*) FROM host_state) > 1 THEN
    RAISE EXCEPTION '0005 found more than one logical host row in a single-owner store. No records were changed.';
  END IF;
  IF EXISTS (SELECT FROM sessions) AND NOT EXISTS (SELECT FROM host_state) THEN
    RAISE EXCEPTION '0005 cannot attribute existing sessions to a logical host. Supply an explicit owner mapping. No records were changed.';
  END IF;
END;
$$;

-- One row binds this logical store (schema) to one canonical application namespace.
-- namespace_id stays NULL for a store that only ever served a host without topology.
CREATE TABLE host_namespaces (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  namespace_id TEXT CHECK (namespace_id IS NULL OR (length(trim(namespace_id)) > 0 AND octet_length(namespace_id) <= 512)),
  -- exclusive: one logical host owns every session. shared: several logical hosts own disjoint sessions.
  store_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (store_mode IN ('exclusive','shared')),
  -- Trusted application configuration revision and digest. Never a credential.
  policy_revision BIGINT NOT NULL DEFAULT 0 CHECK (policy_revision >= 0),
  policy_digest TEXT,
  -- Bumped by an authoritative revocation. Checked inside every fenced transaction.
  authority_revision BIGINT NOT NULL DEFAULT 0 CHECK (authority_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO host_namespaces DEFAULT VALUES;

-- Namespace lifecycle. A bound store is never renamed. It can be destroyed only when
-- nothing active depends on it, and it is bound again only through ahp_recreate_namespace,
-- which invalidates every earlier ownership epoch and membership.
-- Volatile on purpose: each call reads what is committed now, including a member that joined
-- while the caller waited for the join lock.
CREATE FUNCTION ahp_namespace_idle() RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  RETURN NOT EXISTS (SELECT FROM sessions WHERE lifecycle_status <> 'retired')
     AND NOT EXISTS (SELECT FROM work_items WHERE status IN ('queued','leased'))
     AND NOT EXISTS (SELECT FROM host_members WHERE lease_expires_at > clock_timestamp());
END;
$$;
CREATE FUNCTION ahp_guard_namespace() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'A namespace cannot be truncated' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.namespace_id IS NOT NULL AND NEW.namespace_id IS DISTINCT FROM OLD.namespace_id THEN
      RAISE EXCEPTION 'A bound namespace cannot be renamed or rebound' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only ahp_recreate_namespace binds a store again, inside its own transaction.
    IF current_setting('ahp.namespace_recreate', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'A namespace is created only through ahp_recreate_namespace' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ahp_namespace_idle() THEN
    RAISE EXCEPTION 'A namespace with active sessions, work or members cannot be destroyed' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER host_namespaces_guard BEFORE INSERT OR UPDATE OR DELETE ON host_namespaces
  FOR EACH ROW EXECUTE FUNCTION ahp_guard_namespace();
CREATE TRIGGER host_namespaces_truncate_guard BEFORE TRUNCATE ON host_namespaces
  FOR EACH STATEMENT EXECUTE FUNCTION ahp_guard_namespace();
-- A joining host holds this lock while it validates the namespace row and inserts its membership.
-- A deletion takes it before it touches the row, in the same order as a join, so the two queue and
-- cannot deadlock. Waiting and then checking is only sound when the check sees what was committed
-- meanwhile, so a deletion is refused outside read committed.
CREATE FUNCTION ahp_lock_namespace() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A namespace is destroyed or recreated only in a read committed transaction' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock('host_state'::regclass::oid::int, hashtext('ahp-host-join'));
  RETURN NULL;
END;
$$;
CREATE TRIGGER host_namespaces_delete_lock BEFORE DELETE ON host_namespaces
  FOR EACH STATEMENT EXECUTE FUNCTION ahp_lock_namespace();

-- Trusted administrative recreation after a destruction. Earlier memberships are removed
-- and generations are never reused; advancing every epoch refuses earlier ownership.
CREATE FUNCTION ahp_recreate_namespace(new_namespace_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A namespace is destroyed or recreated only in a read committed transaction' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock('host_state'::regclass::oid::int, hashtext('ahp-host-join'));
  IF EXISTS (SELECT FROM host_namespaces) THEN
    RAISE EXCEPTION 'The namespace still exists' USING ERRCODE = '42501';
  END IF;
  IF NOT ahp_namespace_idle() THEN
    RAISE EXCEPTION 'A store with active sessions, work or members cannot be bound again' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('ahp.host_protocol', '2', true);
  UPDATE host_state SET ownership_epoch = ownership_epoch + 1, updated_at = clock_timestamp();
  DELETE FROM host_members;
  PERFORM set_config('ahp.namespace_recreate', '1', true);
  INSERT INTO host_namespaces (namespace_id) VALUES (new_namespace_id);
  PERFORM set_config('ahp.namespace_recreate', '0', true);
END;
$$;
-- These are administrative entry points. They act on this schema whatever the caller's search_path is.
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION ahp_namespace_idle() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION ahp_guard_namespace() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION ahp_lock_namespace() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION ahp_recreate_namespace(text) SET search_path = %I, pg_temp', current_schema());
END;
$$;

-- Namespace-wide native action sequence for shared stores. Allocation never waits
-- on another host's transaction, and a later allocation is always greater.
CREATE SEQUENCE host_server_seq AS BIGINT MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
SELECT setval('host_server_seq', GREATEST(1, seen.value), seen.value > 0)
  FROM (SELECT GREATEST(COALESCE((SELECT max(server_seq) FROM host_state), 0),
    COALESCE((SELECT max(last_server_seq) FROM sessions), 0)) AS value) seen;

-- The singleton index becomes a mode-aware guard. lease_slot keys each logical host's lease.
DROP INDEX host_state_one_logical_store_uidx;
ALTER TABLE host_state
  ADD COLUMN lease_slot INTEGER GENERATED ALWAYS AS IDENTITY (MINVALUE 1) UNIQUE;

CREATE FUNCTION ahp_guard_host_state() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Hosts that understand per-session ownership announce it transaction-locally.
  -- A pre-0005 binary cannot, so its acquisition fails before it changes an epoch.
  IF current_setting('ahp.host_protocol', true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'This store requires host coordination protocol 2' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT FROM host_state WHERE host_id <> NEW.host_id)
     AND (SELECT store_mode FROM host_namespaces) <> 'shared' THEN
    RAISE EXCEPTION 'An exclusive store already belongs to another logical host' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER host_state_guard BEFORE INSERT OR UPDATE ON host_state
  FOR EACH ROW EXECUTE FUNCTION ahp_guard_host_state();

-- Runtime membership. A row is a liveness and discovery record, not an authorization grant.
CREATE SEQUENCE host_member_generation_seq AS BIGINT MINVALUE 1;
CREATE TABLE host_members (
  host_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  -- Unique per join. A stale generation can neither renew nor release a successor.
  generation BIGINT NOT NULL UNIQUE,
  credential_id TEXT,
  policy_revision BIGINT NOT NULL CHECK (policy_revision >= 0),
  role TEXT NOT NULL DEFAULT 'standby' CHECK (role IN ('standby','active','draining')),
  -- Advertised internal endpoint. Routing accepts it only when trusted policy lists it.
  endpoint TEXT CHECK (endpoint IS NULL OR octet_length(endpoint) <= 2048),
  -- Provider and driver facts used for placement eligibility.
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (host_id, instance_id),
  CHECK (length(trim(host_id)) > 0 AND octet_length(host_id) <= 512),
  CHECK (length(trim(instance_id)) > 0 AND octet_length(instance_id) <= 512)
);
CREATE INDEX host_members_live_idx ON host_members (lease_expires_at);

-- Exactly one logical host is the authoritative owner of a session incarnation.
ALTER TABLE sessions
  ADD COLUMN owner_host_id TEXT,
  ADD COLUMN ownership_epoch BIGINT NOT NULL DEFAULT 1 CHECK (ownership_epoch > 0);
UPDATE sessions SET owner_host_id = (SELECT host_id FROM host_state);
-- The backfill queues the deferred root-consistency checks. Run them now so the
-- table can be altered in this same transaction.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE sessions
  ALTER COLUMN owner_host_id SET NOT NULL,
  -- The acting host is the owner of a session it creates. An unfenced insert has no owner and fails.
  ALTER COLUMN owner_host_id SET DEFAULT NULLIF(current_setting('ahp.host_id', true), ''),
  ADD CHECK (length(trim(owner_host_id)) > 0);
CREATE INDEX sessions_owner_host_idx ON sessions (owner_host_id, session_instance_id)
  WHERE lifecycle_status <> 'retired';

CREATE FUNCTION ahp_assert_session_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  acting TEXT := current_setting('ahp.host_id', true);
BEGIN
  IF acting IS NULL OR acting = '' THEN
    RAISE EXCEPTION 'A fenced host identity is required to change a session' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.owner_host_id <> acting THEN
      RAISE EXCEPTION 'A session is created by its owning host' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Ownership moves only through the adapter's explicit transfer and adoption transactions.
  IF current_setting('ahp.session_transfer', true) = '1' THEN
    IF TG_OP = 'UPDATE' AND NEW.owner_host_id IS DISTINCT FROM OLD.owner_host_id
       AND NEW.ownership_epoch <> OLD.ownership_epoch + 1 THEN
      RAISE EXCEPTION 'An ownership change advances the session ownership epoch' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF OLD.owner_host_id <> acting
     OR (TG_OP = 'UPDATE' AND (NEW.owner_host_id <> OLD.owner_host_id OR NEW.ownership_epoch <> OLD.ownership_epoch)) THEN
    RAISE EXCEPTION 'Only the current owning host may change a session' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER sessions_owner_fence BEFORE INSERT OR UPDATE OR DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_session_owner();

-- Durable namespace events. Rows commit atomically with the change they describe
-- and carry identifiers and revisions only: never input, results, tokens or credentials.
CREATE TABLE host_events (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Readers advance by transaction id below the snapshot horizon, so a lower seq
  -- that commits later is never skipped.
  xact_id BIGINT NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
  topic TEXT NOT NULL CHECK (topic IN ('work','ownership','authority','membership')),
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  origin_host_id TEXT,
  session_instance_id UUID,
  domain_id TEXT,
  session_uri TEXT,
  entity_id TEXT,
  revision BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX host_events_xact_idx ON host_events (xact_id, seq);
-- Highest outbox transaction id removed by retention. A reader behind it must reset.
CREATE TABLE host_event_retention (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  pruned_through BIGINT NOT NULL DEFAULT 0
);
INSERT INTO host_event_retention DEFAULT VALUES;
CREATE INDEX host_events_retention_idx ON host_events (occurred_at);

CREATE FUNCTION ahp_record_work_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  change TEXT;
  uri TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    change := 'submitted';
  ELSIF NEW.revision = OLD.revision AND NEW.status = OLD.status THEN
    RETURN NULL;
  ELSIF NEW.status <> OLD.status THEN
    change := CASE NEW.status WHEN 'leased' THEN 'claimed' WHEN 'queued' THEN 'requeued' ELSE NEW.status END;
  ELSIF NEW.status = 'leased' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
    change := 'claimed';
  ELSIF NEW.status = 'leased' AND NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at THEN
    change := 'renewed';
  ELSE
    change := 'dataUpdated';
  END IF;
  SELECT session_uri INTO uri FROM sessions WHERE session_instance_id = NEW.session_instance_id;
  INSERT INTO host_events (topic, kind, origin_host_id, session_instance_id, domain_id, session_uri, entity_id, revision)
    VALUES ('work', change, NULLIF(current_setting('ahp.host_id', true), ''), NEW.session_instance_id, NEW.domain_id, uri, NEW.id::text, NEW.revision);
  -- A wakeup only. Readers recover from the table after a missed notification.
  PERFORM pg_notify('ahp_host_events', 'host_events'::regclass::oid::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER work_items_record_event AFTER INSERT OR UPDATE ON work_items
  FOR EACH ROW EXECUTE FUNCTION ahp_record_work_event();

INSERT INTO schema_migrations (version) VALUES ('0005_host_coordination');
COMMIT;
