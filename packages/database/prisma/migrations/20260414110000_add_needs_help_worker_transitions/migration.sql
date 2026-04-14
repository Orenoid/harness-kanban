DO $$
DECLARE
  current_config jsonb;
  status_id text;
  needs_help_transition jsonb := '{"toStatusId":"needs_help","actionLabel":"Request help"}'::jsonb;
  resume_planning_transition jsonb := '{"toStatusId":"planning","actionLabel":"Resume planning"}'::jsonb;
  transitions jsonb;
BEGIN
  SELECT config::jsonb
  INTO current_config
  FROM public.property
  WHERE id = 'property0003'
  FOR UPDATE;

  IF current_config IS NULL THEN
    RETURN;
  END IF;

  transitions := current_config->'transitions';

  FOREACH status_id IN ARRAY ARRAY[
    'queued',
    'planning',
    'needs_clarification',
    'plan_in_review',
    'in_review'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(transitions->status_id, '[]'::jsonb)) AS transition
      WHERE transition->>'toStatusId' = 'needs_help'
    ) THEN
      transitions := jsonb_set(
        transitions,
        ARRAY[status_id],
        COALESCE(transitions->status_id, '[]'::jsonb) || needs_help_transition,
        true
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(transitions->'needs_help', '[]'::jsonb)) AS transition
    WHERE transition->>'toStatusId' = 'planning'
  ) THEN
    transitions := jsonb_set(
      transitions,
      ARRAY['needs_help'],
      COALESCE(transitions->'needs_help', '[]'::jsonb) || resume_planning_transition,
      true
    );
  END IF;

  UPDATE public.property
  SET config = jsonb_set(current_config, '{transitions}', transitions, true),
      updated_at = NOW()
  WHERE id = 'property0003';
END $$;
