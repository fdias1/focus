CREATE TABLE IF NOT EXISTS monitor_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desktop_id UUID NOT NULL REFERENCES desktop_devices(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL REFERENCES telegram_chats(chat_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS monitor_commands_desktop_state_idx
  ON monitor_commands (desktop_id, state);

CREATE INDEX IF NOT EXISTS monitor_commands_chat_idx
  ON monitor_commands (chat_id);
