-- PostgreSQL-only. Source migration, not auto-applied by an HTTP request.
-- Catalog removal/archival must fail closed until this entire migration is present.
-- Shared writer locks + an exclusive catalog mutation lock close both races:
--   writer first -> mutation sees its committed dependency;
--   mutation first -> writer rechecks the now-deleted/archived parent and fails.
-- No existing content/history is changed or deleted, and no cascade is introduced.
CREATE OR REPLACE FUNCTION knowledge_taxonomy_writer_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('knowledge-taxonomy-mutation-v1'));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION knowledge_taxonomy_assert_base(target TEXT, require_active BOOLEAN) RETURNS void LANGUAGE plpgsql AS $$
DECLARE base_status TEXT;
BEGIN
  IF target IS NULL OR target='' THEN RETURN; END IF;
  SELECT status INTO base_status FROM knowledge_bases WHERE id=target;
  IF NOT FOUND OR (require_active AND base_status<>'active') THEN
    RAISE EXCEPTION 'knowledge_taxonomy_base_unavailable' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION knowledge_taxonomy_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent knowledge_domains%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF current_setting('knowledge.taxonomy_mutation',true) IS DISTINCT FROM 'allowed' THEN
      RAISE EXCEPTION 'knowledge_taxonomy_confirmed_mutation_required' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND NEW.status='archived' AND OLD.status<>'archived'
    AND current_setting('knowledge.taxonomy_mutation',true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'knowledge_taxonomy_confirmed_mutation_required' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='knowledge_domains' THEN
    IF NEW.level='family' THEN
      IF NEW.parent_id IS NOT NULL AND NEW.parent_id<>'' THEN
        RAISE EXCEPTION 'knowledge_taxonomy_family_parent_forbidden' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.level='domain' THEN
      SELECT * INTO parent FROM knowledge_domains WHERE id=NEW.parent_id;
      IF NOT FOUND OR parent.level<>'family' OR (NEW.status='active' AND parent.status<>'active') THEN
        RAISE EXCEPTION 'knowledge_taxonomy_parent_unavailable' USING ERRCODE='23514';
      END IF;
    ELSE RAISE EXCEPTION 'knowledge_taxonomy_level_invalid' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO parent FROM knowledge_domains WHERE id=NEW.domain_id;
    IF NOT FOUND OR parent.level<>'domain' OR (NEW.status='active' AND parent.status<>'active') THEN
      RAISE EXCEPTION 'knowledge_taxonomy_parent_unavailable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='active' AND NOT EXISTS(SELECT 1 FROM knowledge_domains WHERE id=parent.parent_id AND level='family' AND status='active') THEN
      RAISE EXCEPTION 'knowledge_taxonomy_parent_unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION knowledge_taxonomy_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='knowledge_versions' THEN
    -- Historical snapshots may be written while retaining an archived container.
    PERFORM knowledge_taxonomy_assert_base(NEW.base_id,false);
  ELSIF TG_OP='UPDATE' AND NEW.base_id IS NOT DISTINCT FROM OLD.base_id AND NEW.status='archived' THEN
    PERFORM knowledge_taxonomy_assert_base(NEW.base_id,false);
  ELSE
    PERFORM knowledge_taxonomy_assert_base(NEW.base_id,true);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION knowledge_taxonomy_selector_guard(value JSONB, config BOOLEAN) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target TEXT; field TEXT; ref TEXT; base TEXT; key TEXT; item JSONB;
BEGIN
  IF value IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(value)<>'object' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
  FOR key,item IN SELECT * FROM jsonb_each(value) LOOP
    IF (config AND key NOT IN ('base_ids','document_ids')) OR
       (NOT config AND key NOT IN ('ids','base_ids','kinds','tags','stage_codes','brand','lang')) THEN
      RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514';
    END IF;
    IF key IN ('brand','lang') THEN
      IF jsonb_typeof(item)<>'string' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
    ELSE
      IF jsonb_typeof(item)<>'array' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(item) element WHERE jsonb_typeof(element)<>'string') THEN
        RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF value ? 'base_ids' THEN
    IF jsonb_typeof(value->'base_ids')<>'array' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
    FOR target IN SELECT jsonb_array_elements_text(value->'base_ids') LOOP
      IF target IS NULL OR target='' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
      PERFORM knowledge_taxonomy_assert_base(target,true);
    END LOOP;
  END IF;
  field := CASE WHEN config THEN 'document_ids' ELSE 'ids' END;
  IF value ? field THEN
    IF jsonb_typeof(value->field)<>'array' THEN RAISE EXCEPTION 'knowledge_taxonomy_selector_invalid' USING ERRCODE='23514'; END IF;
    FOR ref IN SELECT jsonb_array_elements_text(value->field) LOOP
      IF config THEN SELECT base_id INTO base FROM knowledge_documents WHERE id=ref;
      ELSE SELECT base_id INTO base FROM (SELECT id,base_id FROM knowledge UNION ALL SELECT id,base_id FROM knowledge_documents) assets WHERE id=ref LIMIT 1;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_taxonomy_asset_unavailable' USING ERRCODE='23514'; END IF;
      PERFORM knowledge_taxonomy_assert_base(base,true);
    END LOOP;
  END IF;
  IF NOT config THEN
    -- Same matching rules as knowledge/binding-selector.ts, including wildcard,
    -- historical versions, comma-separated tags, '*' brand and default language.
    -- The shared statement lock is already held: an archive that won the race
    -- has committed before we inspect the matching parents here.
    FOR base IN SELECT DISTINCT a.base_id FROM (
      SELECT id,base_id,kind,tags,brand,lang FROM knowledge
      UNION ALL SELECT knowledge_id AS id,base_id,kind,tags,brand,lang FROM knowledge_versions
      UNION ALL SELECT id,base_id,'document' AS kind,NULL AS tags,NULL AS brand,NULL AS lang FROM knowledge_documents
    ) a WHERE
      (COALESCE(jsonb_array_length(value->'ids'),0)=0 OR value->'ids' ? a.id)
      AND (COALESCE(jsonb_array_length(value->'base_ids'),0)=0 OR value->'base_ids' ? a.base_id)
      AND (COALESCE(jsonb_array_length(value->'kinds'),0)=0 OR value->'kinds' ? COALESCE(a.kind,''))
      AND (COALESCE(jsonb_array_length(value->'tags'),0)=0 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(value->'tags') selected(tag)
        JOIN unnest(string_to_array(COALESCE(a.tags,''),',')) stored(tag) ON selected.tag=btrim(stored.tag)))
      AND (COALESCE(btrim(value->>'brand'),'')='' OR COALESCE(NULLIF(a.brand,''),'*') IN ('*',btrim(value->>'brand')))
      AND (COALESCE(btrim(value->>'lang'),'')='' OR COALESCE(NULLIF(a.lang,''),'en')=btrim(value->>'lang'))
    LOOP
      PERFORM knowledge_taxonomy_assert_base(base,true);
    END LOOP;
  END IF;

END $$;

CREATE OR REPLACE FUNCTION knowledge_taxonomy_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base TEXT; body JSONB;
BEGIN
  IF TG_TABLE_NAME='knowledge_bindings' THEN
    PERFORM knowledge_taxonomy_selector_guard(NEW.selector::jsonb,false);
  ELSIF TG_TABLE_NAME='skill_knowledge_configs' THEN
    PERFORM knowledge_taxonomy_selector_guard(NEW.selector::jsonb,true);
    PERFORM knowledge_taxonomy_selector_guard(NEW.published_selector::jsonb,true);
  ELSIF TG_TABLE_NAME='knowledge_publication_bindings' THEN
    PERFORM knowledge_taxonomy_assert_base(NEW.base_id,true);
  ELSIF TG_TABLE_NAME='knowledge_publication_requests' THEN
    PERFORM knowledge_taxonomy_assert_base(NEW.snapshot->>'base_id',TG_OP='INSERT');
  ELSIF TG_TABLE_NAME='knowledge_publication_applications' THEN
    body:=NEW.snapshot::jsonb;
    PERFORM knowledge_taxonomy_assert_base(COALESCE(body->>'baseId',body->'fields'->>'base_id'),TG_OP='INSERT');
  ELSIF TG_TABLE_NAME='knowledge_document_jobs' AND NEW.status IN ('queued','running') THEN
    SELECT base_id INTO base FROM knowledge_documents WHERE id=NEW.document_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_taxonomy_asset_unavailable' USING ERRCODE='23514'; END IF;
    PERFORM knowledge_taxonomy_assert_base(base,true);
  END IF;
  RETURN NEW;
END $$;

-- Execution jobs include unrelated work. Only knowledge jobs take this lock;
-- no global queue serialization, no lock for email/crawl/scheduling writes.
CREATE OR REPLACE FUNCTION knowledge_taxonomy_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base TEXT; body JSONB;
BEGIN
  IF NEW.job_type NOT LIKE 'knowledge.%' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('knowledge-taxonomy-mutation-v1'));
  IF NEW.status NOT IN ('queued','running','retrying','uncertain') THEN RETURN NEW; END IF;
  body:=NEW.payload_json::jsonb;
  IF NEW.job_type='knowledge.skill.generate' THEN
    PERFORM knowledge_taxonomy_selector_guard(jsonb_build_object('base_ids',body->'spec'->'base_ids'),true);
  ELSIF NEW.job_type='knowledge.scope' THEN
    SELECT base_id INTO base FROM knowledge_documents WHERE id=body->>'document_id';
    IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_taxonomy_asset_unavailable' USING ERRCODE='23514'; END IF;
    PERFORM knowledge_taxonomy_assert_base(base,true);
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE tab TEXT;
BEGIN
  FOREACH tab IN ARRAY ARRAY['knowledge_domains','knowledge_bases','knowledge','knowledge_documents','knowledge_versions',
    'knowledge_bindings','skill_knowledge_configs','knowledge_publication_bindings','knowledge_publication_requests',
    'knowledge_publication_applications','knowledge_document_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER knowledge_taxonomy_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION knowledge_taxonomy_writer_lock()',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['knowledge_domains','knowledge_bases'] LOOP
    EXECUTE format('CREATE TRIGGER knowledge_taxonomy_parent BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION knowledge_taxonomy_parent_guard()',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['knowledge','knowledge_documents','knowledge_versions'] LOOP
    EXECUTE format('CREATE TRIGGER knowledge_taxonomy_asset BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION knowledge_taxonomy_asset_guard()',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['knowledge_bindings','skill_knowledge_configs','knowledge_publication_bindings','knowledge_publication_requests','knowledge_publication_applications','knowledge_document_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER knowledge_taxonomy_reference BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION knowledge_taxonomy_reference_guard()',tab);
  END LOOP;
END $$;
CREATE TRIGGER knowledge_taxonomy_job BEFORE INSERT OR UPDATE ON execution_jobs FOR EACH ROW EXECUTE FUNCTION knowledge_taxonomy_job_guard();

-- The version gate checks each expected enabled trigger, target and function.
-- A partial/disabled installation must never report safe catalog mutation support.
CREATE OR REPLACE FUNCTION knowledge_taxonomy_guard_version() RETURNS INTEGER LANGUAGE sql STABLE AS $$
  WITH expected(rel,trigger_name,function_name,trigger_type) AS (
    SELECT unnest(ARRAY['knowledge_domains','knowledge_bases','knowledge','knowledge_documents','knowledge_versions','knowledge_bindings','skill_knowledge_configs','knowledge_publication_bindings','knowledge_publication_requests','knowledge_publication_applications','knowledge_document_jobs']), 'knowledge_taxonomy_lock','knowledge_taxonomy_writer_lock',30
    UNION ALL SELECT unnest(ARRAY['knowledge_domains','knowledge_bases']),'knowledge_taxonomy_parent','knowledge_taxonomy_parent_guard',31
    UNION ALL SELECT unnest(ARRAY['knowledge','knowledge_documents','knowledge_versions']),'knowledge_taxonomy_asset','knowledge_taxonomy_asset_guard',23
    UNION ALL SELECT unnest(ARRAY['knowledge_bindings','skill_knowledge_configs','knowledge_publication_bindings','knowledge_publication_requests','knowledge_publication_applications','knowledge_document_jobs']),'knowledge_taxonomy_reference','knowledge_taxonomy_reference_guard',23
    UNION ALL SELECT 'execution_jobs','knowledge_taxonomy_job','knowledge_taxonomy_job_guard',23
  ) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid=to_regclass(e.rel) AND t.tgname=e.trigger_name AND t.tgenabled IN ('O','A') AND p.proname=e.function_name AND t.tgtype=e.trigger_type
        AND t.tgfoid=to_regprocedure(e.function_name || '()')
    )) THEN 1 ELSE 0 END;
$$;
