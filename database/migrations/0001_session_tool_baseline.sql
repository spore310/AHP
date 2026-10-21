-- AHP canonical session/tool baseline.
--
-- PostgreSQL 17 is the target dev/test dialect for this POC. These scripts are
-- written but have not been applied or runtime-tested yet. These tables are
-- durable projections only; the live SessionRegistry, sockets, subscriptions
-- and client tool advertisements remain in memory.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE host_state (
  host_id TEXT PRIMARY KEY,
  server_seq BIGINT NOT NULL DEFAULT 0 CHECK (server_seq >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  provider_id TEXT NOT NULL,
  display_name TEXT,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  creation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_key, version),
  CHECK (length(trim(type_key)) BETWEEN 1 AND 128),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (jsonb_typeof(config_schema) = 'object')
);

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  display_name TEXT,
  description TEXT,
  schema_dialect TEXT NOT NULL DEFAULT 'json-schema',
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
  session_uri TEXT PRIMARY KEY,
  session_type_id UUID REFERENCES session_types(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  owner_principal_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_server_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_server_seq >= 0),
  durable_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (length(trim(session_uri)) > 0),
  CHECK (length(trim(provider_id)) > 0),
  CHECK (length(trim(owner_principal_subject)) > 0),
  CHECK (jsonb_typeof(durable_state) = 'object')
);

CREATE INDEX sessions_modified_idx
  ON sessions (modified_at DESC, session_uri);
CREATE INDEX sessions_owner_idx
  ON sessions (owner_principal_subject);

-- Record this script's applied version so a reader or future runner of the
-- bookkeeping table can see the baseline was applied. The table is created at
-- the top of this file.
INSERT INTO schema_migrations (version) VALUES ('0001_session_tool_baseline');
