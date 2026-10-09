-- Lease generations remain monotonic. Answered clarification cycles provide
-- separate, bounded credits rather than reusing an earlier claim generation.
ALTER TABLE jobs ADD COLUMN clarification_rounds INTEGER NOT NULL DEFAULT 0;
UPDATE jobs SET clarification_rounds=MIN(5,attempts,(
  SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(thread) THEN thread ELSE '[]' END)
  WHERE json_extract(value,'$.kind')='reply'
));
