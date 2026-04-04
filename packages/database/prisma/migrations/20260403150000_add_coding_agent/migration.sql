CREATE TABLE "coding_agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coding_agent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coding_agent_name_key" ON "coding_agent"("name");
CREATE INDEX "coding_agent_type_idx" ON "coding_agent"("type");
CREATE INDEX "coding_agent_type_is_default_idx" ON "coding_agent"("type", "is_default");
