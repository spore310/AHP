-- Optional RAW DDL acceptance smoke; authored, not executed in this review.
-- Run only after AHP_V1_Target_Schema.sql in an explicitly disposable PostgreSQL 17 database.
-- The fixture uses generated identities and is rolled back. No concurrency or
-- application authorization claim follows from this one-connection script.
-- psql invocation must use -X -v ON_ERROR_STOP=1.
BEGIN ISOLATION LEVEL READ COMMITTED;
DO $$
DECLARE
  type_id UUID := gen_random_uuid();
  session_a UUID := gen_random_uuid();
  session_b UUID := gen_random_uuid();
  replacement_session UUID := gen_random_uuid();
  root_a UUID := gen_random_uuid();
  root_b UUID := gen_random_uuid();
  chat_a UUID := gen_random_uuid();
  agent_a UUID := gen_random_uuid();
  work_a UUID := gen_random_uuid();
  work_b UUID := gen_random_uuid();
  uri_a TEXT := 'ahp://schema-smoke/' || session_a::text;
  uri_b TEXT := 'ahp://schema-smoke/' || session_b::text;
  affected INTEGER;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO session_types(id, type_key, version, provider_id)
    VALUES (type_id, 'smoke-' || type_id::text, 1, 'smoke-provider');
  INSERT INTO sessions(session_instance_id, domain_id, session_uri,
    session_type_id, provider_id, owner_principal_subject, lifecycle_status)
    VALUES
      (session_a, 'smoke-domain-a', uri_a, type_id, 'smoke-provider', 'owner-a', 'active'),
      (session_b, 'smoke-domain-b', uri_b, type_id, 'smoke-provider', 'owner-b', 'active');
  -- These registration JSON objects only exercise database object checks.
  -- The real repository must validate the complete registered V1 shape.
  INSERT INTO canonical_resources(resource_pk, session_instance_id, domain_id,
    kind, resource_id, instance_id, owner_principal_subject, provider_id,
    lifecycle_status, registration_data, runtime_driver_key, runtime_driver_version)
    VALUES
      (root_a, session_a, 'smoke-domain-a', 'session', uri_a, session_a::text,
       'owner-a', 'smoke-provider', 'active', '{"version":1}', 'smoke-root', 1),
      (root_b, session_b, 'smoke-domain-b', 'session', uri_b, session_b::text,
       'owner-b', 'smoke-provider', 'active', '{"version":1}', 'smoke-root', 1);
  INSERT INTO canonical_resources(resource_pk, session_instance_id, domain_id,
    kind, resource_id, instance_id, owner_principal_subject, provider_id,
    parent_resource_pk, lifecycle_status, registration_data,
    runtime_driver_key, runtime_driver_version, data)
    VALUES (chat_a, session_a, 'smoke-domain-a', 'chat', uri_a || '/chat',
      'opaque-chat-incarnation', 'owner-a', 'smoke-provider', root_a, 'active',
      '{"version":1}', 'smoke-chat', 1, '{"nested":{"values":[true,null,3]}}');
  INSERT INTO agent_registrations(id, domain_id, principal_subject, agent_key)
    VALUES (agent_a, 'smoke-domain-a', 'worker-a', 'smoke-agent');
  INSERT INTO work_items(id, session_instance_id, domain_id, request_key, kind,
    input, submitted_by_kind, submitted_by_subject)
    VALUES
      (work_a, session_a, 'smoke-domain-a', 'a', 'smoke-work', '{}', 'user', 'owner-a'),
      (work_b, session_a, 'smoke-domain-a', 'b', 'smoke-work', '{}', 'user', 'owner-a');
  INSERT INTO work_resource_selections(work_id, session_instance_id, domain_id,
    purpose, resource_pk, include, include_descendants)
    VALUES
      (work_a, session_a, 'smoke-domain-a', 'scope', root_a, TRUE, TRUE),
      (work_b, session_a, 'smoke-domain-a', 'scope', chat_a, TRUE, FALSE);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  -- Missing root is a deferred cross-row violation.
  BEGIN
    INSERT INTO sessions(domain_id, session_uri, session_type_id, provider_id,
      owner_principal_subject)
      VALUES ('smoke-domain-a', uri_a || '/missing-root', type_id, 'smoke-provider', 'owner-a');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected missing-root rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    UPDATE canonical_resources SET owner_principal_subject = 'wrong-owner'
      WHERE resource_pk = root_a;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected root/session mismatch rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    UPDATE canonical_resources SET parent_resource_pk = root_b
      WHERE resource_pk = chat_a;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected cross-session/domain parent rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    UPDATE work_items SET lease_token = gen_random_uuid() WHERE id = work_a;
    RAISE EXCEPTION 'Expected partial lease rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE work_items SET status = 'leased', lease_agent_id = agent_a,
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '1 minute',
      attempt_count = 1 WHERE id = work_a;
    RAISE EXCEPTION 'Expected missing execution-epoch rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE work_items SET data = '[]'::jsonb WHERE id = work_a;
    RAISE EXCEPTION 'Expected non-object data rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE work_items SET result = '{}'::jsonb WHERE id = work_a;
    RAISE EXCEPTION 'Expected result/status mismatch rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO work_items(session_instance_id, domain_id, request_key, kind,
      input, submitted_by_kind, submitted_by_subject)
      VALUES (session_a, 'smoke-domain-a', 'missing-scope', 'smoke-work', '{}', 'user', 'owner-a');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected positive-scope rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    DELETE FROM work_resource_selections WHERE work_id = work_a;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected last-positive-scope deletion rejection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  -- Checks BOTH old and new work identities during selector rekey.
  BEGIN
    UPDATE work_resource_selections SET work_id = work_b WHERE work_id = work_a;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Expected old-work positive-scope rejection on rekey';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  UPDATE work_items SET data = '{"checkpoint":1}', data_revision = data_revision + 1,
    revision = revision + 1 WHERE id = work_a AND data_revision = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'First sequential CAS must update one row'; END IF;
  UPDATE work_items SET data = '{"checkpoint":2}', data_revision = data_revision + 1,
    revision = revision + 1 WHERE id = work_a AND data_revision = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Stale sequential CAS must update no rows'; END IF;
  IF (SELECT submitted_data FROM work_items WHERE id = work_a) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Mutable data changed immutable submitted_data';
  END IF;

  BEGIN
    DELETE FROM sessions WHERE session_instance_id = session_a;
    RAISE EXCEPTION 'Expected dependency-protected session purge rejection';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- URI reuse is legal only after logical retirement of the old instance/root.
  UPDATE work_items SET status = 'cancelled' WHERE id IN (work_a, work_b);
  UPDATE canonical_resources SET lifecycle_status = 'retired', retired_at = clock_timestamp()
    WHERE session_instance_id = session_a;
  UPDATE sessions SET lifecycle_status = 'retired', retired_at = clock_timestamp()
    WHERE session_instance_id = session_a;
  INSERT INTO sessions(session_instance_id, domain_id, session_uri, session_type_id,
    provider_id, owner_principal_subject, lifecycle_status)
    VALUES (replacement_session, 'smoke-domain-a', uri_a, type_id, 'smoke-provider', 'owner-a', 'active');
  INSERT INTO canonical_resources(session_instance_id, domain_id, kind, resource_id,
    instance_id, owner_principal_subject, provider_id, lifecycle_status,
    registration_data, runtime_driver_key, runtime_driver_version)
    VALUES (replacement_session, 'smoke-domain-a', 'session', uri_a,
      replacement_session::text, 'owner-a', 'smoke-provider', 'active',
      '{"version":1}', 'smoke-root', 1);
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE 'DDL smoke assertions completed; fixture transaction will roll back';
END;
$$;
ROLLBACK;
