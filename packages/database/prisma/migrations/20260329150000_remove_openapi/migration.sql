-- Remove OpenAPI bot user
DELETE FROM "user" WHERE id = 'bot_openapi';

-- Drop api_key table
DROP TABLE IF EXISTS "api_key";
