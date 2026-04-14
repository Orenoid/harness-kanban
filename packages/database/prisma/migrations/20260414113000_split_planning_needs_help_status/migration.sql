DO $$
DECLARE
  current_config jsonb;
  statuses jsonb;
  transitions jsonb;
  status_id text;
  planning_needs_help_status jsonb := '{"id":"planning_needs_help","icon":"LifeBuoy","label":"Needs help"}'::jsonb;
  planning_needs_help_transition jsonb := '{"toStatusId":"planning_needs_help","actionLabel":"Request help"}'::jsonb;
  resume_planning_transition jsonb := '{"toStatusId":"planning","actionLabel":"Resume planning"}'::jsonb;
  cancel_transition jsonb := '{"toStatusId":"canceled","actionLabel":"Cancel"}'::jsonb;
BEGIN
  SELECT config::jsonb
  INTO current_config
  FROM public.property
  WHERE id = 'property0003'
  FOR UPDATE;

  IF current_config IS NULL THEN
    RETURN;
  END IF;

  statuses := COALESCE(current_config->'statuses', '[]'::jsonb);
  transitions := COALESCE(current_config->'transitions', '{}'::jsonb);

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(statuses) AS existing_status(status_value)
    WHERE status_value->>'id' = 'planning_needs_help'
  ) THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN status_value->>'id' = 'planning_needs_help'
            THEN status_value || '{"icon":"LifeBuoy","label":"Needs help"}'::jsonb
          ELSE status_value
        END
        ORDER BY ordinality
      ),
      '[]'::jsonb
    )
    INTO statuses
    FROM jsonb_array_elements(statuses) WITH ORDINALITY AS existing_status(status_value, ordinality);
  ELSE
    SELECT COALESCE(jsonb_agg(status_value ORDER BY sort_order), '[]'::jsonb)
    INTO statuses
    FROM (
      SELECT
        status_value,
        ordinality * 2 AS sort_order
      FROM jsonb_array_elements(statuses) WITH ORDINALITY AS existing_status(status_value, ordinality)
      UNION ALL
      SELECT
        planning_needs_help_status,
        COALESCE(
          (
            SELECT ordinality * 2 + 1
            FROM jsonb_array_elements(statuses) WITH ORDINALITY AS existing_status(status_value, ordinality)
            WHERE status_value->>'id' = 'planning'
            LIMIT 1
          ),
          9999
        ) AS sort_order
    ) ordered_statuses;
  END IF;

  FOREACH status_id IN ARRAY ARRAY[
    'queued',
    'planning',
    'needs_clarification',
    'plan_in_review',
    'in_review'
  ]
  LOOP
    transitions := jsonb_set(
      transitions,
      ARRAY[status_id],
      (
        SELECT COALESCE(jsonb_agg(transition_value), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(transitions->status_id, '[]'::jsonb)) AS existing_transition(transition_value)
        WHERE transition_value->>'toStatusId' <> 'needs_help'
      ),
      true
    );
  END LOOP;

  transitions := jsonb_set(
    transitions,
    ARRAY['needs_help'],
    (
      SELECT COALESCE(jsonb_agg(transition_value), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(transitions->'needs_help', '[]'::jsonb)) AS existing_transition(transition_value)
      WHERE transition_value->>'toStatusId' <> 'planning'
    ),
    true
  );

  FOREACH status_id IN ARRAY ARRAY['queued', 'planning']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(transitions->status_id, '[]'::jsonb)) AS existing_transition(transition_value)
      WHERE transition_value->>'toStatusId' = 'planning_needs_help'
    ) THEN
      transitions := jsonb_set(
        transitions,
        ARRAY[status_id],
        COALESCE(transitions->status_id, '[]'::jsonb) || planning_needs_help_transition,
        true
      );
    END IF;
  END LOOP;

  transitions := jsonb_set(
    transitions,
    ARRAY['planning_needs_help'],
    jsonb_build_array(resume_planning_transition, cancel_transition),
    true
  );

  UPDATE public.property
  SET config = jsonb_set(
        jsonb_set(current_config, '{statuses}', statuses, true),
        '{transitions}',
        transitions,
        true
      ),
      updated_at = NOW()
  WHERE id = 'property0003';
END $$;
