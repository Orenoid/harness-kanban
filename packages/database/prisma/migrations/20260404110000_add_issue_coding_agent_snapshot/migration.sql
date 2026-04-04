CREATE TABLE "issue_coding_agent_snapshot" (
    "id" TEXT NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "source_coding_agent_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_coding_agent_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issue_coding_agent_snapshot_issue_id_key" ON "issue_coding_agent_snapshot"("issue_id");
CREATE INDEX "issue_coding_agent_snapshot_type_idx" ON "issue_coding_agent_snapshot"("type");

ALTER TABLE "issue_coding_agent_snapshot"
ADD CONSTRAINT "issue_coding_agent_snapshot_issue_id_fkey"
FOREIGN KEY ("issue_id") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
