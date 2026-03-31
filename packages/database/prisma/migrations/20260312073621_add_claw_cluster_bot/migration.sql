INSERT INTO "user" (id, name, email, "emailVerified", type, image, "createdAt", "updatedAt")
VALUES (
  'bot_code_bot',
  'CodeBot',
  'bot@code-bot.local',
  true,
  'bot',
  '/images/bot-avatar.svg',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
