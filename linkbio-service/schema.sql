CREATE SCHEMA IF NOT EXISTS oz_linkbio;

CREATE TABLE IF NOT EXISTS oz_linkbio.items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wp_post_id BIGINT NOT NULL,
  design_version TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_url TEXT NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  category TEXT,
  author TEXT,
  approval_status TEXT NOT NULL,
  approved_by_user_id TEXT,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  instagram_status TEXT NOT NULL DEFAULT 'pending',
  instagram_container_id TEXT,
  instagram_media_id TEXT,
  instagram_permalink TEXT,
  instagram_published_at TIMESTAMPTZ,
  gallery_status TEXT NOT NULL DEFAULT 'pending',
  visible_at TIMESTAMPTZ,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oz_linkbio_item_version_unique UNIQUE (wp_post_id, design_version),
  CONSTRAINT oz_linkbio_article_url_domain CHECK (
    article_url ~ '^https://(www\.)?otomotifzone\.com(/|$)'
  ),
  CONSTRAINT oz_linkbio_image_https CHECK (image_url ~ '^https://'),
  CONSTRAINT oz_linkbio_thumbnail_https CHECK (thumbnail_url IS NULL OR thumbnail_url ~ '^https://'),
  CONSTRAINT oz_linkbio_approval_status CHECK (
    approval_status IN ('waiting_approval','approved','revision_requested','rendering','skipped','failed')
  ),
  CONSTRAINT oz_linkbio_instagram_status CHECK (
    instagram_status IN ('pending','publishing','published','failed','unknown')
  ),
  CONSTRAINT oz_linkbio_gallery_status CHECK (
    gallery_status IN ('pending','visible','hidden','failed')
  ),
  CONSTRAINT oz_linkbio_visible_requires_publish CHECK (
    gallery_status <> 'visible' OR (
      approval_status = 'approved'
      AND instagram_status = 'published'
      AND instagram_media_id IS NOT NULL
      AND instagram_published_at IS NOT NULL
      AND visible_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS oz_linkbio_instagram_media_unique
  ON oz_linkbio.items (instagram_media_id)
  WHERE instagram_media_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS oz_linkbio_visible_order_idx
  ON oz_linkbio.items (visible_at DESC, id DESC)
  WHERE gallery_status = 'visible';

CREATE INDEX IF NOT EXISTS oz_linkbio_retry_idx
  ON oz_linkbio.items (next_retry_at)
  WHERE gallery_status = 'failed' OR instagram_status IN ('failed','unknown');

CREATE TABLE IF NOT EXISTS oz_linkbio.events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL,
  link_kind TEXT,
  wp_post_id BIGINT,
  design_version TEXT,
  visitor_hash TEXT NOT NULL,
  client_kind TEXT NOT NULL,
  referrer_host TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oz_linkbio_event_type CHECK (event_type IN ('page_view','link_click')),
  CONSTRAINT oz_linkbio_link_kind CHECK (
    link_kind IS NULL OR link_kind IN ('article','website','youtube','instagram','bagibagi','saweria')
  )
);

CREATE INDEX IF NOT EXISTS oz_linkbio_events_time_idx
  ON oz_linkbio.events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS oz_linkbio_events_article_idx
  ON oz_linkbio.events (wp_post_id, design_version, occurred_at DESC)
  WHERE event_type = 'link_click' AND link_kind = 'article';

CREATE INDEX IF NOT EXISTS oz_linkbio_events_visitor_idx
  ON oz_linkbio.events (visitor_hash, occurred_at DESC);

CREATE OR REPLACE VIEW oz_linkbio.analytics_daily AS
SELECT
  (occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS event_date,
  COUNT(*) FILTER (WHERE event_type='page_view') AS page_views,
  COUNT(DISTINCT visitor_hash) FILTER (WHERE event_type='page_view') AS unique_visitors,
  COUNT(*) FILTER (WHERE event_type='link_click') AS total_clicks,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE event_type='link_click') /
    NULLIF(COUNT(*) FILTER (WHERE event_type='page_view'), 0),
    2
  ) AS click_rate_percent
FROM oz_linkbio.events
GROUP BY 1;

CREATE OR REPLACE VIEW oz_linkbio.analytics_links AS
SELECT
  (occurred_at AT TIME ZONE 'Asia/Jakarta')::date AS event_date,
  link_kind,
  COUNT(*) AS clicks,
  COUNT(DISTINCT visitor_hash) AS unique_clickers
FROM oz_linkbio.events
WHERE event_type='link_click'
GROUP BY 1, 2;

CREATE OR REPLACE VIEW oz_linkbio.analytics_articles AS
SELECT
  e.wp_post_id,
  e.design_version,
  i.article_title,
  i.article_url,
  COUNT(*) AS clicks,
  COUNT(DISTINCT e.visitor_hash) AS unique_clickers,
  MAX(e.occurred_at) AS last_clicked_at
FROM oz_linkbio.events e
JOIN oz_linkbio.items i USING (wp_post_id, design_version)
WHERE e.event_type='link_click' AND e.link_kind='article'
GROUP BY e.wp_post_id, e.design_version, i.article_title, i.article_url;

CREATE OR REPLACE VIEW oz_linkbio.analytics_sources AS
SELECT
  COALESCE(utm_source, 'direct') AS source,
  COALESCE(utm_medium, 'none') AS medium,
  COALESCE(utm_campaign, 'none') AS campaign,
  COUNT(*) FILTER (WHERE event_type='page_view') AS page_views,
  COUNT(*) FILTER (WHERE event_type='link_click') AS clicks,
  COUNT(DISTINCT visitor_hash) AS unique_visitors
FROM oz_linkbio.events
GROUP BY 1, 2, 3;

CREATE OR REPLACE FUNCTION oz_linkbio.publish_item(
  p_wp_post_id BIGINT,
  p_design_version TEXT,
  p_article_title TEXT,
  p_article_url TEXT,
  p_image_url TEXT,
  p_alt_text TEXT,
  p_caption TEXT,
  p_category TEXT,
  p_author TEXT,
  p_approved_by_user_id TEXT,
  p_approved_by_name TEXT,
  p_approved_at TIMESTAMPTZ,
  p_instagram_container_id TEXT,
  p_instagram_media_id TEXT,
  p_instagram_permalink TEXT,
  p_instagram_published_at TIMESTAMPTZ
) RETURNS oz_linkbio.items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, oz_linkbio
AS $function$
DECLARE
  result_row oz_linkbio.items;
  desired_gallery_status TEXT := 'visible';
BEGIN
  IF p_wp_post_id IS NULL OR p_wp_post_id = 0 OR COALESCE(trim(p_design_version),'') = '' THEN
    RAISE EXCEPTION 'Identitas artikel/versi tidak valid.';
  END IF;
  IF p_article_url !~ '^https://(www\.)?otomotifzone\.com(/|$)' THEN
    RAISE EXCEPTION 'Domain artikel tidak valid.';
  END IF;
  IF p_image_url !~ '^https://' OR COALESCE(trim(p_instagram_media_id),'') = '' OR p_instagram_published_at IS NULL THEN
    RAISE EXCEPTION 'Data publikasi Instagram belum lengkap.';
  END IF;

  PERFORM pg_advisory_xact_lock(p_wp_post_id);

  IF EXISTS (
    SELECT 1 FROM oz_linkbio.items
    WHERE wp_post_id = p_wp_post_id
      AND design_version <> p_design_version
      AND gallery_status = 'visible'
      AND instagram_published_at > p_instagram_published_at
  ) THEN
    desired_gallery_status := 'hidden';
  ELSE
    UPDATE oz_linkbio.items
    SET gallery_status='hidden', updated_at=now()
    WHERE wp_post_id=p_wp_post_id
      AND design_version<>p_design_version
      AND gallery_status='visible';
  END IF;

  INSERT INTO oz_linkbio.items (
    wp_post_id, design_version, article_title, article_url,
    image_url, thumbnail_url, alt_text, caption, category, author,
    approval_status, approved_by_user_id, approved_by_name, approved_at,
    instagram_status, instagram_container_id, instagram_media_id,
    instagram_permalink, instagram_published_at, gallery_status, visible_at
  ) VALUES (
    p_wp_post_id, p_design_version, p_article_title, p_article_url,
    p_image_url, p_image_url, p_alt_text, COALESCE(p_caption,''), p_category, p_author,
    'approved', p_approved_by_user_id, p_approved_by_name, p_approved_at,
    'published', p_instagram_container_id, p_instagram_media_id,
    p_instagram_permalink, p_instagram_published_at, desired_gallery_status,
    CASE WHEN desired_gallery_status='visible' THEN now() ELSE NULL END
  )
  ON CONFLICT (wp_post_id, design_version) DO UPDATE SET
    article_title=EXCLUDED.article_title,
    article_url=EXCLUDED.article_url,
    image_url=EXCLUDED.image_url,
    thumbnail_url=EXCLUDED.thumbnail_url,
    alt_text=EXCLUDED.alt_text,
    caption=EXCLUDED.caption,
    category=EXCLUDED.category,
    author=EXCLUDED.author,
    approval_status='approved',
    approved_by_user_id=EXCLUDED.approved_by_user_id,
    approved_by_name=EXCLUDED.approved_by_name,
    approved_at=EXCLUDED.approved_at,
    instagram_status='published',
    instagram_container_id=EXCLUDED.instagram_container_id,
    instagram_media_id=EXCLUDED.instagram_media_id,
    instagram_permalink=EXCLUDED.instagram_permalink,
    instagram_published_at=EXCLUDED.instagram_published_at,
    gallery_status=EXCLUDED.gallery_status,
    visible_at=CASE
      WHEN EXCLUDED.gallery_status='visible' THEN COALESCE(oz_linkbio.items.visible_at, now())
      ELSE NULL
    END,
    last_error=NULL,
    next_retry_at=NULL,
    updated_at=now()
  RETURNING * INTO result_row;

  RETURN result_row;
END
$function$;

REVOKE ALL ON FUNCTION oz_linkbio.publish_item(
  BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TIMESTAMPTZ
) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oz_approval_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA oz_linkbio TO oz_approval_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION oz_linkbio.publish_item(
      BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,
      TEXT,TEXT,TEXT,TIMESTAMPTZ
    ) TO oz_approval_app';
  END IF;
END
$grant$;

DO $dashboard_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oz_linkbio_web') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA oz_linkbio TO oz_linkbio_web';
    EXECUTE 'GRANT SELECT ON oz_linkbio.items,oz_linkbio.events,oz_linkbio.analytics_daily,oz_linkbio.analytics_links,oz_linkbio.analytics_articles,oz_linkbio.analytics_sources TO oz_linkbio_web';
    EXECUTE 'GRANT USAGE ON SCHEMA oz_approval TO oz_linkbio_web';
    EXECUTE 'GRANT SELECT ON oz_approval.decisions,oz_approval.outbox,oz_approval.ingestion_state,oz_approval.ingestion_articles TO oz_linkbio_web';
  END IF;
END
$dashboard_grant$;
