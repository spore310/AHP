-- Agent Hosting Protocol durable session/resource foundation (PostgreSQL 17).
-- Keep the preflight, schema changes, deferred checks and migration receipt atomic.
BEGIN;

LOCK TABLE sessions, work_items, agent_registrations IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT FROM sessions) OR EXISTS (SELECT FROM work_items)
     OR EXISTS (SELECT FROM agent_registrations) THEN
    RAISE EXCEPTION '0003 requires empty legacy session, work and registration tables. Supply an explicit application mapping before upgrading populated stores.';
  END IF;
END;
$$;

ALTER TABLE host_state
  ADD COLUMN ownership_epoch BIGINT NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
  ADD CHECK (server_seq <= 9007199254740991),
  ADD CHECK (length(trim(host_id)) > 0);
CREATE UNIQUE INDEX host_state_one_logical_store_uidx ON host_state ((TRUE));

-- Existing catalogue rows retain their identifiers and metadata.
ALTER TABLE tools ALTER COLUMN schema_dialect SET DEFAULT 'draft-07';

-- The exclusive locks above keep these identity tables empty across the upgrade.
ALTER TABLE work_items DROP COLUMN session_uri;
DROP TABLE sessions;
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
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
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


ALTER TABLE work_items
  ADD COLUMN session_instance_id UUID NOT NULL,
  ADD COLUMN domain_id TEXT NOT NULL,
  ADD UNIQUE (session_instance_id, request_key),
  ADD UNIQUE (id, session_instance_id, domain_id),
  ADD FOREIGN KEY (session_instance_id, domain_id)
    REFERENCES sessions (session_instance_id, domain_id) ON DELETE RESTRICT;
CREATE INDEX work_items_session_idx ON work_items (session_instance_id, created_at DESC);
CREATE INDEX work_items_queued_claim_idx ON work_items (session_instance_id, created_at, id)
  WHERE status = 'queued';
CREATE INDEX work_items_expired_claim_idx ON work_items (session_instance_id, lease_expires_at, created_at, id)
  WHERE status = 'leased';

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


INSERT INTO schema_migrations (version) VALUES ('0003_durable_session_resources');
COMMIT;
