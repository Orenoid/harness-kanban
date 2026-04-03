CREATE TABLE "workspace_github_connection" (
    "workspace_id" TEXT NOT NULL,
    "github_token_encrypted" TEXT NOT NULL,
    "github_token_updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_github_connection_pkey" PRIMARY KEY ("workspace_id")
);

INSERT INTO "workspace_github_connection" (
    "workspace_id",
    "github_token_encrypted",
    "github_token_updated_at",
    "created_at",
    "updated_at"
)
SELECT
    'default-workspace-id',
    "github_token_encrypted",
    COALESCE("github_token_updated_at", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "user"
WHERE "github_token_encrypted" IS NOT NULL
ORDER BY COALESCE("github_token_updated_at", "updatedAt") DESC
LIMIT 1
ON CONFLICT ("workspace_id") DO NOTHING;

ALTER TABLE "user"
DROP COLUMN "github_token_encrypted",
DROP COLUMN "github_token_updated_at";
