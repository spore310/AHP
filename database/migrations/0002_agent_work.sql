-- AHP M2 agent identity and durable work leases.
--
-- Exactly two tables are added for this slice. Agent presence, sockets,
-- subscriptions and client tool availability intentionally have no SQL rows.

CREATE TABLE agent_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_subject TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  display_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_subject, agent_key),
  CHECK (length(trim(principal_subject)) > 0),
  CHECK (length(trim(agent_key)) BETWEEN 1 AND 128),
  CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 200)
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_uri TEXT NOT NULL REFERENCES sessions(session_uri) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  input JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  target_agent_id UUID REFERENCES agent_registrations(id) ON DELETE RESTRICT,
  lease_agent_id UUID REFERENCES agent_registrations(id) ON DELETE RESTRICT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_uri, request_key),
  CHECK (length(trim(request_key)) BETWEEN 1 AND 256),
  CHECK (length(trim(kind)) BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(input) = 'object'),
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (status = 'leased') =
      (lease_agent_id IS NOT NULL
       AND lease_token IS NOT NULL
       AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX work_items_queued_claim_idx
  ON work_items (session_uri, created_at, id)
  WHERE status = 'queued';

CREATE INDEX work_items_expired_claim_idx
  ON work_items (session_uri, lease_expires_at, created_at, id)
  WHERE status = 'leased';

CREATE INDEX work_items_session_idx
  ON work_items (session_uri, created_at DESC);

-- Record this script's applied version alongside the baseline row from
-- `0001_session_tool_baseline.sql`.
INSERT INTO schema_migrations (version) VALUES ('0002_agent_work');
