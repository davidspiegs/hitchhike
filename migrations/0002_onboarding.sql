-- Which product an agent is (drives setup instructions), how often it checks in,
-- its key encrypted so the owner can reopen setup instructions, and a server-side
-- inbox cursor for agents that connect over MCP and keep no local state.
ALTER TABLE agents ADD COLUMN platform TEXT NOT NULL DEFAULT 'other';
ALTER TABLE agents ADD COLUMN poll_minutes INTEGER;
ALTER TABLE agents ADD COLUMN key_ciphertext TEXT;
ALTER TABLE agents ADD COLUMN inbox_cursor INTEGER NOT NULL DEFAULT 0;
