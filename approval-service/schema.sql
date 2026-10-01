CREATE SCHEMA IF NOT EXISTS oz_approval;

CREATE TABLE IF NOT EXISTS oz_approval.decisions (
  post_id BIGINT NOT NULL,
  design_version UUID NOT NULL DEFAULT gen_random_uuid(),
  version_no INTEGER NOT NULL,
  parent_version UUID UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'preparing', 'waiting_approval', 'approved', 'revision_requested',
    'rendering', 'skipped', 'publishing', 'channel_sent', 'published',
    'failed', 'publishing_unknown'
  )),
  decision_action TEXT,
  decided_by_user_id BIGINT,
  decided_by_name TEXT,
  decided_by_username TEXT,
  decided_at TIMESTAMPTZ,
  approval_group_chat_id BIGINT NOT NULL,
  approval_photo_message_id BIGINT,
  approval_message_id BIGINT,
  notification_channel_chat_id BIGINT NOT NULL,
  channel_message_id BIGINT,
  telegram_photo_file_id TEXT,
  instagram_container_id TEXT,
  instagram_media_id TEXT,
  instagram_permalink TEXT,
  instagram_published_at TIMESTAMPTZ,
  content_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, design_version),
  UNIQUE (post_id, version_no),
  UNIQUE (design_version),
  UNIQUE (approval_group_chat_id, approval_message_id)
);

CREATE TABLE IF NOT EXISTS oz_approval.outbox (
  post_id BIGINT NOT NULL,
  design_version UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('channel', 'revise', 'rerender')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'unknown')) DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, design_version, action),
  FOREIGN KEY (post_id, design_version) REFERENCES oz_approval.decisions(post_id, design_version)
);

CREATE INDEX IF NOT EXISTS oz_approval_decisions_status_idx ON oz_approval.decisions(status);
CREATE INDEX IF NOT EXISTS oz_approval_outbox_state_idx ON oz_approval.outbox(state);

CREATE TABLE IF NOT EXISTS oz_approval.ingestion_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  watermark_post_id BIGINT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO oz_approval.ingestion_state(singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS oz_approval.ingestion_articles (
  post_id BIGINT PRIMARY KEY,
  article_json JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','completed','dead')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oz_approval_ingestion_queue_idx
  ON oz_approval.ingestion_articles(state, published_at, post_id);
CREATE INDEX IF NOT EXISTS oz_approval_ingestion_lease_idx
  ON oz_approval.ingestion_articles(lease_until) WHERE state='leased';

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oz_approval_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA oz_approval TO oz_approval_app';
    EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON oz_approval.ingestion_state TO oz_approval_app';
    EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON oz_approval.ingestion_articles TO oz_approval_app';
  END IF;
END
$grant$;

ALTER TABLE oz_approval.decisions ADD COLUMN IF NOT EXISTS instagram_container_id TEXT;
ALTER TABLE oz_approval.decisions ADD COLUMN IF NOT EXISTS instagram_media_id TEXT;
ALTER TABLE oz_approval.decisions ADD COLUMN IF NOT EXISTS instagram_permalink TEXT;
ALTER TABLE oz_approval.decisions ADD COLUMN IF NOT EXISTS instagram_published_at TIMESTAMPTZ;
