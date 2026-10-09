-- Additive conversation history. Job rows remain the request/lease source of truth.
ALTER TABLE jobs ADD COLUMN conversation_id TEXT;
ALTER TABLE jobs ADD COLUMN chain_root_id TEXT;
ALTER TABLE jobs ADD COLUMN delegation_depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN claim_consumer TEXT;
ALTER TABLE jobs ADD COLUMN requires_consumer INTEGER NOT NULL DEFAULT 0;
CREATE INDEX jobs_conversation ON jobs(workspace_id,conversation_id,created_at);
CREATE INDEX jobs_chain ON jobs(workspace_id,chain_root_id);

CREATE TABLE conversation_chains (
  workspace_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  max_requests INTEGER NOT NULL DEFAULT 26,
  requests_used INTEGER NOT NULL DEFAULT 0,
  max_depth INTEGER NOT NULL DEFAULT 5,
  stopped_at INTEGER,
  PRIMARY KEY(workspace_id,root_id)
);
CREATE TABLE conversations (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  participants TEXT NOT NULL,
  chain_root_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  stopped_at INTEGER,
  retention_days INTEGER NOT NULL DEFAULT 30,
  pinned_context TEXT NOT NULL DEFAULT '',
  context_version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX conversations_recent ON conversations(workspace_id,last_message_at,id);
CREATE TABLE conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_id TEXT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  result TEXT,
  context TEXT,
  source_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id,source_key)
);
CREATE INDEX conversation_messages_page ON conversation_messages(workspace_id,conversation_id,id);
CREATE TABLE conversation_receipts (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  consumer_id TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,conversation_id,agent_id,consumer_id)
);

-- Surviving legacy data is copied verbatim; previously overwritten results cannot
-- be reconstructed. Legacy broadcasts stay legacy: their audience is not widened.
UPDATE jobs SET conversation_id='conv_'||id,chain_root_id=id;
-- Existing job chains retain their original five-level/25-descendant limits.
-- Recover their actual lineage so migration cannot reset an existing allowance.
WITH RECURSIVE lineage(workspace_id,id,root_id,depth) AS (
  SELECT j.workspace_id,j.id,j.id,0 FROM jobs j WHERE j.parent_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM jobs p WHERE p.workspace_id=j.workspace_id AND p.id=j.parent_id)
  UNION ALL
  SELECT j.workspace_id,j.id,l.root_id,l.depth+1 FROM jobs j JOIN lineage l
    ON l.workspace_id=j.workspace_id AND l.id=j.parent_id WHERE l.depth<100
)
UPDATE jobs SET (chain_root_id,delegation_depth)=(SELECT root_id,depth FROM lineage l WHERE l.workspace_id=jobs.workspace_id AND l.id=jobs.id)
  WHERE EXISTS(SELECT 1 FROM lineage l WHERE l.workspace_id=jobs.workspace_id AND l.id=jobs.id);
INSERT INTO conversation_chains(workspace_id,root_id,requests_used)
  SELECT workspace_id,chain_root_id,COUNT(*) FROM jobs GROUP BY workspace_id,chain_root_id;
INSERT INTO conversations(workspace_id,id,title,participants,chain_root_id,created_at,last_message_at,retention_days)
  SELECT workspace_id,conversation_id,title,json_array(from_agent,to_agent),chain_root_id,created_at,updated_at,COALESCE((SELECT retention_days FROM workspaces WHERE workspaces.id=jobs.workspace_id),30) FROM jobs;
INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,source_key,created_at)
  SELECT workspace_id,conversation_id,id,from_agent,to_agent,'request',COALESCE(json_extract(CASE WHEN json_valid(spec) THEN spec ELSE '{}' END,'$.goal'),''),id||':request',created_at FROM jobs ORDER BY created_at,id;
INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,source_key,created_at)
  SELECT j.workspace_id,j.conversation_id,j.id,COALESCE(NULLIF(json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.from'),''),'legacy-unattributed'),
    CASE WHEN json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.from')=j.from_agent THEN j.to_agent ELSE j.from_agent END,
    CASE json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.kind') WHEN 'feedback' THEN 'revision' ELSE COALESCE(json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.kind'),'note') END,
    COALESCE(json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.text'),CAST(e.value AS TEXT),'[legacy entry with no text]'),j.id||':thread:'||e.key,
    COALESCE(CAST((julianday(json_extract(CASE WHEN e.type='object' THEN e.value ELSE '{}' END,'$.at'))-2440587.5)*86400000 AS INTEGER),j.updated_at)
  FROM jobs j,json_each(CASE WHEN json_valid(j.thread) AND json_type(j.thread)='array' THEN j.thread ELSE '[]' END) e ORDER BY j.created_at,j.id,e.key;
INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,result,source_key,created_at)
  SELECT workspace_id,conversation_id,id,COALESCE(result_by,'relay'),from_agent,
    CASE status WHEN 'failed' THEN 'failure' ELSE 'answer' END,COALESCE(json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.summary'),''),result,
    id||':result:'||attempts,COALESCE(completed_at,updated_at) FROM jobs WHERE result IS NOT NULL ORDER BY completed_at,id;

-- Triggers preserve a successful transition and its message in the SAME database
-- transaction. They do not rely on wall-clock uniqueness or follow-up logging.
CREATE TRIGGER conversation_job_created AFTER INSERT ON jobs BEGIN
  INSERT OR IGNORE INTO conversation_chains(workspace_id,root_id,max_requests,max_depth)
    VALUES(NEW.workspace_id,COALESCE(NEW.chain_root_id,NEW.id),CASE WHEN NEW.requires_consumer=1 THEN 10 ELSE 26 END,CASE WHEN NEW.requires_consumer=1 THEN 2 ELSE 5 END);
  UPDATE conversation_chains SET requests_used=requests_used+1 WHERE workspace_id=NEW.workspace_id AND root_id=COALESCE(NEW.chain_root_id,NEW.id);
  INSERT OR IGNORE INTO conversations(workspace_id,id,title,participants,chain_root_id,created_at,last_message_at,retention_days)
    VALUES(NEW.workspace_id,COALESCE(NEW.conversation_id,'conv_'||NEW.id),NEW.title,json_array(NEW.from_agent,NEW.to_agent),COALESCE(NEW.chain_root_id,NEW.id),NEW.created_at,NEW.created_at,CASE WHEN NEW.requires_consumer=1 THEN 30 ELSE COALESCE((SELECT retention_days FROM workspaces WHERE id=NEW.workspace_id),30) END);
  UPDATE jobs SET conversation_id=COALESCE(NEW.conversation_id,'conv_'||NEW.id),chain_root_id=COALESCE(NEW.chain_root_id,NEW.id)
    WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
  INSERT INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,source_key,created_at)
    VALUES(NEW.workspace_id,COALESCE(NEW.conversation_id,'conv_'||NEW.id),NEW.id,NEW.from_agent,NEW.to_agent,'request',COALESCE(json_extract(NEW.spec,'$.goal'),''),NEW.id||':request',NEW.created_at);
END;
CREATE TRIGGER conversation_job_thread AFTER UPDATE OF thread ON jobs WHEN NEW.thread<>OLD.thread BEGIN
  INSERT OR IGNORE INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,source_key,created_at)
    SELECT NEW.workspace_id,NEW.conversation_id,NEW.id,json_extract(e.value,'$.from'),
      CASE WHEN json_extract(e.value,'$.from')=NEW.from_agent THEN NEW.to_agent ELSE NEW.from_agent END,
      CASE json_extract(e.value,'$.kind') WHEN 'feedback' THEN 'revision' ELSE json_extract(e.value,'$.kind') END,
      json_extract(e.value,'$.text'),NEW.id||':thread:'||e.key,NEW.updated_at
    FROM json_each(NEW.thread) e WHERE CAST(e.key AS INTEGER)>=json_array_length(OLD.thread);
END;
CREATE TRIGGER conversation_job_result AFTER UPDATE OF result ON jobs WHEN NEW.result IS NOT NULL AND NEW.result IS NOT OLD.result BEGIN
  INSERT OR IGNORE INTO conversation_messages(workspace_id,conversation_id,request_id,from_agent,to_agent,kind,text,result,source_key,created_at)
    VALUES(NEW.workspace_id,NEW.conversation_id,NEW.id,COALESCE(NEW.result_by,'relay'),NEW.from_agent,
      CASE NEW.status WHEN 'failed' THEN 'failure' ELSE 'answer' END,COALESCE(json_extract(NEW.result,'$.summary'),''),NEW.result,
      NEW.id||':result:'||NEW.attempts,NEW.updated_at);
END;
CREATE TRIGGER conversation_message_added AFTER INSERT ON conversation_messages BEGIN
  UPDATE conversations SET last_message_at=MAX(last_message_at,NEW.created_at) WHERE workspace_id=NEW.workspace_id AND id=NEW.conversation_id;
END;
-- Permanent removal of the last quota receipt also removes any orphan records.
CREATE TRIGGER conversation_job_deleted AFTER DELETE ON jobs BEGIN
  DELETE FROM conversation_messages WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.conversation_id
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.conversation_id);
  DELETE FROM conversation_receipts WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.conversation_id
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.conversation_id);
  DELETE FROM conversations WHERE workspace_id=OLD.workspace_id AND id=OLD.conversation_id
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.conversation_id);
  DELETE FROM conversation_chains WHERE workspace_id=OLD.workspace_id AND root_id=OLD.chain_root_id
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE workspace_id=OLD.workspace_id AND chain_root_id=OLD.chain_root_id);
END;

-- Deleting a retained thread is one atomic operation, including its immutable
-- transcript and content copies in legacy request rows. Quota receipts remain.
CREATE TRIGGER conversation_deleted AFTER DELETE ON conversations BEGIN
  DELETE FROM conversation_messages WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.id;
  DELETE FROM conversation_receipts WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.id;
  UPDATE jobs SET title='Deleted by retention',spec='{}',thread='[]',result=NULL,error=NULL
    WHERE workspace_id=OLD.workspace_id AND conversation_id=OLD.id;
END;
