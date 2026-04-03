ALTER TABLE "user"
ADD COLUMN "github_token_encrypted" TEXT,
ADD COLUMN "github_token_updated_at" TIMESTAMP(3);
