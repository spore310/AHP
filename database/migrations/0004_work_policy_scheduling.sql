-- Agent Hosting Protocol P1. Existing P0 session/resource incarnations remain intact.
BEGIN;
LOCK TABLE work_resource_selections, work_items, agent_registrations IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT FROM agent_registrations) OR EXISTS (SELECT FROM work_items) THEN
    RAISE EXCEPTION '0004 requires an explicit application mapping for populated P0 work or registrations. No records were changed.';
  END IF;
END;
$$;

ALTER TABLE session_types
  ADD COLUMN work_manifest JSONB NOT NULL DEFAULT '{"kinds":[]}'::jsonb
    CHECK (jsonb_typeof(work_manifest) = 'object');

-- The preflight and existing selector FKs establish that all three tables are empty.
DROP TABLE work_resource_selections;
DROP TABLE work_items;
DROP TABLE agent_registrations;
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

INSERT INTO schema_migrations (version) VALUES ('0004_work_policy_scheduling');
COMMIT;
