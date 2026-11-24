-- Agent Hosting Protocol V1 target schema — reviewed planning reference.
-- Baseline: spore310/AHP develop bcd85354723bce293e1384af0ca88e84d5ce9dda.
-- PostgreSQL 17, UTF-8, standard 8 KiB pages. Fresh EMPTY schema only.
-- This is NOT an upgrade script. P0/P1 author forward 0003/0004 migrations
-- from the two existing baselines; refuse nonempty legacy identity/work tables
-- unless an explicit application-supplied migration mapping is provided.
-- No production repository/database was changed by authoring this reference.
-- The portable repository contract must implement the same invariants.
BEGIN;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- host_id identifies the logical store, not a random process.
-- P0 acquires one namespace advisory lock on a DEDICATED connection, then
-- increments ownership_epoch. All mutation transactions hold this row FOR SHARE
-- and compare their expected epoch. Acquire ownership at host composition, not
-- once per repository pool. One active authoritative host per logical store.
CREATE TABLE host_state (
  host_id TEXT PRIMARY KEY,
  ownership_epoch BIGINT NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
  server_seq BIGINT NOT NULL DEFAULT 0
    CHECK (server_seq BETWEEN 0 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim(host_id)) > 0)
);
CREATE UNIQUE INDEX host_state_one_logical_store_uidx ON host_state ((TRUE));

CREATE TABLE session_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  provider_id TEXT NOT NULL,
  display_name TEXT,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  work_manifest JSONB NOT NULL DEFAULT '{"kinds":[]}'::jsonb,
  creation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_key, version),
  CHECK (length(trim(type_key)) BETWEEN 1 AND 128),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (jsonb_typeof(config_schema) = 'object'),
  CHECK (jsonb_typeof(work_manifest) = 'object')
);

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  display_name TEXT,
  description TEXT,
  -- Existing baseline says json-schema; trusted runtime uses draft-07.
  -- Align this descriptor in the migration without changing validation behavior.
  schema_dialect TEXT NOT NULL DEFAULT 'draft-07',
  input_schema JSONB NOT NULL,
  output_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_key, version),
  CHECK (length(trim(tool_key)) BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(input_schema) = 'object'),
  CHECK (output_schema IS NULL OR jsonb_typeof(output_schema) = 'object')
);

CREATE TABLE session_type_tools (
  session_type_id UUID NOT NULL REFERENCES session_types(id) ON DELETE RESTRICT,
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_type_id, tool_id)
);

CREATE TABLE sessions (
  session_instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id TEXT NOT NULL,
  session_uri TEXT NOT NULL,
  -- Durable mode requires an exact trusted type. In-memory untyped tests may remain.
  session_type_id UUID NOT NULL REFERENCES session_types(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  owner_principal_subject TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'creating' CHECK (
    lifecycle_status IN ('creating','active','suspended','failed','retiring','retired')
  ),
  state_revision BIGINT NOT NULL DEFAULT 1 CHECK (state_revision > 0),
  graph_revision BIGINT NOT NULL DEFAULT 1 CHECK (graph_revision > 0),
  durable_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_server_seq BIGINT NOT NULL DEFAULT 0
    CHECK (last_server_seq BETWEEN 0 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE (session_instance_id, domain_id),
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(session_uri)) > 0 AND octet_length(session_uri) <= 2048),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (length(trim(owner_principal_subject)) > 0),
  CHECK (octet_length(domain_id) <= 512),
  CHECK (octet_length(domain_id) + octet_length(owner_principal_subject) <= 2048),
  CHECK (jsonb_typeof(durable_state) = 'object'),
  CHECK ((lifecycle_status = 'retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX sessions_nonretired_uri_uidx
  ON sessions (session_uri) WHERE lifecycle_status <> 'retired';
CREATE INDEX sessions_owner_idx ON sessions (domain_id, owner_principal_subject);
CREATE INDEX sessions_recovery_idx
  ON sessions (lifecycle_status, session_instance_id)
  WHERE lifecycle_status <> 'retired';

CREATE TABLE canonical_resources (
  resource_pk UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  -- Opaque public ResourceRef identity: not generally a UUID.
  instance_id TEXT NOT NULL,
  owner_principal_subject TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  parent_resource_pk UUID,
  grant_parent_resource_pk UUID,
  lifecycle_status TEXT NOT NULL DEFAULT 'creating' CHECK (
    lifecycle_status IN ('creating','active','suspended','failed','retiring','retired')
  ),
  resource_revision BIGINT NOT NULL DEFAULT 1 CHECK (resource_revision > 0),
  relationship_revision BIGINT NOT NULL DEFAULT 1 CHECK (relationship_revision > 0),
  data_revision BIGINT NOT NULL DEFAULT 1 CHECK (data_revision > 0),
  -- Durable facts only; reconstruct and revalidate against current trusted code.
  -- Exact schema is PersistedResourceRegistrationV1 in the contract packet.
  registration_data JSONB NOT NULL,
  runtime_driver_key TEXT NOT NULL,
  runtime_driver_version INTEGER NOT NULL CHECK (runtime_driver_version > 0),
  -- Reserved before an external call. Retry/reconcile by the SAME key.
  provision_key UUID NOT NULL DEFAULT gen_random_uuid(),
  recovery_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Consumer-owned instance data, separate from recovery and authorization facts.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  UNIQUE (domain_id, kind, resource_id, instance_id),
  UNIQUE (resource_pk, session_instance_id, domain_id),
  UNIQUE (provision_key),
  FOREIGN KEY (session_instance_id, domain_id)
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (grant_parent_resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(kind)) > 0),
  CHECK (length(trim(resource_id)) > 0),
  CHECK (length(trim(instance_id)) > 0),
  CHECK (length(trim(owner_principal_subject)) > 0),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (length(trim(runtime_driver_key)) > 0),
  -- Shared SDK UTF-8 identity budget; avoids oversized multibyte B-tree keys.
  CHECK (octet_length(domain_id) + octet_length(kind)
         + octet_length(resource_id) + octet_length(instance_id) <= 2048),
  CHECK (parent_resource_pk IS NULL OR parent_resource_pk <> resource_pk),
  CHECK (grant_parent_resource_pk IS NULL OR grant_parent_resource_pk <> resource_pk),
  CHECK (jsonb_typeof(registration_data) = 'object'),
  CHECK (jsonb_typeof(recovery_input) = 'object'),
  CHECK (jsonb_typeof(runtime_metadata) = 'object'),
  CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((lifecycle_status = 'retired') = (retired_at IS NOT NULL)),
  CHECK (
    (kind = 'session' AND instance_id = session_instance_id::text
     AND parent_resource_pk IS NULL AND grant_parent_resource_pk IS NULL)
    OR (kind <> 'session' AND parent_resource_pk IS NOT NULL)
  )
);
CREATE UNIQUE INDEX canonical_resources_nonretired_id_uidx
  ON canonical_resources (kind, resource_id) WHERE lifecycle_status <> 'retired';
CREATE UNIQUE INDEX canonical_resources_one_session_root_uidx
  ON canonical_resources (session_instance_id) WHERE kind = 'session';
CREATE INDEX canonical_resources_parent_idx
  ON canonical_resources (session_instance_id, parent_resource_pk);
CREATE INDEX canonical_resources_grant_parent_idx
  ON canonical_resources (session_instance_id, grant_parent_resource_pk);
CREATE INDEX canonical_resources_recovery_idx
  ON canonical_resources (session_instance_id, lifecycle_status, resource_pk);

CREATE TABLE agent_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id TEXT NOT NULL,
  principal_subject TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  display_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Fencing counter only. Never a persisted assertion that this agent is online.
  execution_epoch BIGINT NOT NULL DEFAULT 0 CHECK (execution_epoch >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_id, principal_subject, agent_key),
  UNIQUE (id, domain_id),
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(principal_subject)) > 0),
  CHECK (length(trim(agent_key)) BETWEEN 1 AND 128),
  CHECK (octet_length(domain_id) + octet_length(principal_subject)
         + octet_length(agent_key) <= 2048),
  CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 200)
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  input JSONB NOT NULL,
  -- Immutable initial data makes retries independent from subsequent data updates.
  submitted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_revision BIGINT NOT NULL DEFAULT 1 CHECK (data_revision > 0),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','leased','completed','failed','cancelled')
  ),
  submitted_by_kind TEXT NOT NULL CHECK (submitted_by_kind IN ('user','agent')),
  submitted_by_subject TEXT NOT NULL,
  submitted_by_agent_id TEXT,
  target_agent_id UUID,
  lease_agent_id UUID,
  lease_execution_epoch BIGINT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  result JSONB,
  last_failure_code TEXT,
  last_failure_message TEXT,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_instance_id, kind, request_key),
  UNIQUE (id, session_instance_id, domain_id),
  FOREIGN KEY (session_instance_id, domain_id)
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_agent_id, domain_id)
    REFERENCES agent_registrations (id, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (lease_agent_id, domain_id)
    REFERENCES agent_registrations (id, domain_id) ON DELETE RESTRICT,
  CHECK (length(trim(domain_id)) > 0),
  CHECK (length(trim(kind)) BETWEEN 1 AND 128),
  CHECK (length(trim(request_key)) BETWEEN 1 AND 256),
  CHECK (octet_length(kind) + octet_length(request_key) <= 2048),
  CHECK (length(trim(submitted_by_subject)) > 0),
  CHECK (submitted_by_agent_id IS NULL OR length(trim(submitted_by_agent_id)) > 0),
  CHECK ((submitted_by_kind = 'agent') = (submitted_by_agent_id IS NOT NULL)),
  CHECK (jsonb_typeof(input) = 'object'),
  CHECK (jsonb_typeof(submitted_data) = 'object'),
  CHECK (jsonb_typeof(data) = 'object'),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK ((status = 'completed') = (result IS NOT NULL)),
  CHECK (last_failure_code IS NULL OR length(last_failure_code) BETWEEN 1 AND 64),
  CHECK (last_failure_message IS NULL OR length(last_failure_message) BETWEEN 1 AND 512),
  CHECK ((last_failure_code IS NULL) = (last_failed_at IS NULL)),
  CHECK (last_failure_message IS NULL OR last_failure_code IS NOT NULL),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (status = 'leased' AND lease_agent_id IS NOT NULL
     AND lease_execution_epoch IS NOT NULL AND lease_execution_epoch > 0
     AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
     AND attempt_count > 0)
    OR
    (status <> 'leased' AND lease_agent_id IS NULL
     AND lease_execution_epoch IS NULL AND lease_token IS NULL
     AND lease_expires_at IS NULL)
  )
);
CREATE INDEX work_items_queued_priority_idx
  ON work_items (session_instance_id, priority DESC, created_at, id)
  WHERE status = 'queued';
CREATE INDEX work_items_expired_claim_idx
  ON work_items (session_instance_id, lease_expires_at, priority DESC, created_at, id)
  WHERE status = 'leased';
CREATE INDEX work_items_active_agent_idx
  ON work_items (lease_agent_id, lease_expires_at) WHERE status = 'leased';
CREATE INDEX work_items_session_list_idx
  ON work_items (session_instance_id, created_at, id);

CREATE TABLE work_resource_selections (
  work_id UUID NOT NULL,
  session_instance_id UUID NOT NULL,
  domain_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('scope','announce')),
  resource_pk UUID NOT NULL,
  include BOOLEAN NOT NULL,
  include_descendants BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (work_id, purpose, resource_pk),
  FOREIGN KEY (work_id, session_instance_id, domain_id)
    REFERENCES work_items (id, session_instance_id, domain_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_pk, session_instance_id, domain_id)
    REFERENCES canonical_resources (resource_pk, session_instance_id, domain_id)
    ON DELETE RESTRICT
);
CREATE INDEX work_resource_selections_resource_idx
  ON work_resource_selections (resource_pk, purpose);

-- Cross-row root consistency cannot be implemented with a row CHECK.
-- Deferred checks allow session + root reserve/activate/retire in one transaction.
CREATE FUNCTION ahp_assert_session_root() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  candidate UUID;
  candidates UUID[] := ARRAY[]::UUID[];
  session_row sessions%ROWTYPE;
  root_row canonical_resources%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.session_instance_id); END IF;
  IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.session_instance_id); END IF;
  FOR candidate IN SELECT DISTINCT value FROM unnest(candidates) AS ids(value) ORDER BY value LOOP
    -- READ COMMITTED adapter contract: fence session fact changes, then read
    -- dependent facts in a fresh statement after any lock wait. SHARE avoids
    -- a deferred lock upgrade for independent resource-data writers. Session
    -- lifecycle/root mutations already take their exclusive locks up front.
    SELECT * INTO session_row FROM sessions
      WHERE session_instance_id = candidate FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO root_row FROM canonical_resources
      WHERE session_instance_id = candidate AND kind = 'session';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session requires a canonical root' USING ERRCODE = '23514';
    END IF;
    IF ROW(root_row.domain_id, root_row.resource_id, root_row.instance_id,
           root_row.owner_principal_subject, root_row.provider_id, root_row.lifecycle_status)
       IS DISTINCT FROM
       ROW(session_row.domain_id, session_row.session_uri, candidate::text,
           session_row.owner_principal_subject, session_row.provider_id, session_row.lifecycle_status) THEN
      RAISE EXCEPTION 'Session root facts must match session' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sessions_require_root
  AFTER INSERT OR UPDATE ON sessions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_session_root();
CREATE CONSTRAINT TRIGGER resources_preserve_root
  AFTER INSERT OR UPDATE OR DELETE ON canonical_resources DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_session_root();

CREATE FUNCTION ahp_assert_work_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  candidate UUID;
  candidates UUID[] := ARRAY[]::UUID[];
BEGIN
  IF TG_TABLE_NAME = 'work_items' THEN
    IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN candidates := array_append(candidates, OLD.work_id); END IF;
    IF TG_OP <> 'DELETE' THEN candidates := array_append(candidates, NEW.work_id); END IF;
  END IF;
  FOR candidate IN SELECT DISTINCT value FROM unnest(candidates) AS ids(value) ORDER BY value LOOP
    -- Common-parent serialization prevents concurrent removal of the last
    -- positive selections. A separate fresh statement follows the lock wait.
    PERFORM id FROM work_items WHERE id = candidate FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT EXISTS (
       SELECT 1 FROM work_resource_selections
       WHERE work_id = candidate AND purpose = 'scope' AND include
    ) THEN
      RAISE EXCEPTION 'Work requires a positive scope selection' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER work_requires_scope
  AFTER INSERT OR UPDATE ON work_items DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_work_scope();
CREATE CONSTRAINT TRIGGER selections_preserve_scope
  AFTER INSERT OR UPDATE OR DELETE ON work_resource_selections DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ahp_assert_work_scope();

COMMIT;

-- Service/repository obligations, intentionally not claimed as DDL guarantees:
-- 1. Identity, type/provider, immutable submissions and selectors never mutate.
-- 2. Containment/grant-parent graphs are acyclic; existing edges are immutable
--    in V1. Insertion and retirement serialize on the exact session row and
--    advance graph_revision. Parents must be active, except creation under
--    the same host-issued in-flight capability; such children stay unavailable
--    until the full session/ancestor chain is active.
-- 3. Data schemas, UTF-8 byte/depth/key budgets, and projections are enforced
--    before I/O; JSONB object checks alone are not a size or schema validator.
-- 4. Current trusted policy, host epoch, live readiness, execution epoch,
--    lease token, attempt and database deadline fence every applicable command.
-- 5. Claim/renew capacity uses a separate agent-lock statement before counting.
-- 6. Physical purge deletes terminal work and its selectors first, then
--    resources in reverse containment/grant dependency order, then session.
-- 7. No grants, opaque proof receipts, sockets, presence, functions, arbitrary
--    credentials or runtime handles are reconstructed from these JSON columns.
-- 8. Repository writes and deferred cross-row checks use READ COMMITTED;
--    other isolation modes are unsupported until separately proved. Lock
--    distinct touched parent IDs in stable order before multi-row mutation.
--    Arbitrary direct SQL lock order can deadlock and must safely roll back.

