ALTER TABLE "coding_agent"
ADD COLUMN "workspace_id" TEXT;

UPDATE "coding_agent" AS "ca"
SET "workspace_id" = "resolved"."workspace_id"
FROM (
    SELECT "snapshot"."source_coding_agent_id" AS "coding_agent_id", MIN("issue"."workspace_id") AS "workspace_id"
    FROM "issue_coding_agent_snapshot" AS "snapshot"
    INNER JOIN "issue" ON "issue"."id" = "snapshot"."issue_id"
    WHERE "snapshot"."source_coding_agent_id" IS NOT NULL
      AND "issue"."workspace_id" IS NOT NULL
    GROUP BY "snapshot"."source_coding_agent_id"
    HAVING COUNT(DISTINCT "issue"."workspace_id") = 1
) AS "resolved"
WHERE "ca"."id" = "resolved"."coding_agent_id"
  AND "ca"."workspace_id" IS NULL;

UPDATE "coding_agent"
SET "workspace_id" = "fallback"."workspace_id"
FROM (
    SELECT MIN("workspace_id") AS "workspace_id"
    FROM "project"
    WHERE "workspace_id" IS NOT NULL
    HAVING COUNT(DISTINCT "workspace_id") = 1
) AS "fallback"
WHERE "coding_agent"."workspace_id" IS NULL
  AND "fallback"."workspace_id" IS NOT NULL;

UPDATE "coding_agent"
SET "workspace_id" = "fallback"."workspace_id"
FROM (
    SELECT MIN("workspace_id") AS "workspace_id"
    FROM "issue"
    WHERE "workspace_id" IS NOT NULL
    HAVING COUNT(DISTINCT "workspace_id") = 1
) AS "fallback"
WHERE "coding_agent"."workspace_id" IS NULL
  AND "fallback"."workspace_id" IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "coding_agent" WHERE "workspace_id" IS NULL) THEN
        RAISE EXCEPTION 'Cannot infer coding_agent.workspace_id for all rows. Backfill the column manually before applying this migration.';
    END IF;
END $$;

ALTER TABLE "coding_agent"
ALTER COLUMN "workspace_id" SET NOT NULL;

DROP INDEX "coding_agent_name_key";
DROP INDEX "coding_agent_type_idx";
DROP INDEX "coding_agent_type_is_default_idx";

CREATE UNIQUE INDEX "coding_agent_workspace_id_name_key" ON "coding_agent"("workspace_id", "name");
CREATE INDEX "coding_agent_workspace_id_created_at_idx" ON "coding_agent"("workspace_id", "created_at");
CREATE INDEX "coding_agent_workspace_id_type_created_at_idx" ON "coding_agent"("workspace_id", "type", "created_at");
CREATE INDEX "coding_agent_workspace_id_is_default_idx" ON "coding_agent"("workspace_id", "is_default");

ALTER TABLE "issue_coding_agent_snapshot"
ADD COLUMN "execution_state" JSONB;
