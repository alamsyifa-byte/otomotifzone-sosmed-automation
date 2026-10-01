import http from 'node:http';
import { Pool } from 'pg';
import { collaboratorConfig, resolveCollaborators } from './collaborators.mjs';

const port = Number(process.env.PORT || 3001);
const groupId = String(process.env.APPROVAL_GROUP_CHAT_ID || '');
const channelId = String(process.env.NOTIFICATION_CHANNEL_CHAT_ID || '');
const botId = String(process.env.TELEGRAM_BOT_ID || '');
if (!groupId || !channelId || !botId) throw new Error('Approval chat IDs and Telegram bot ID are required.');
const db = new Pool({ max: 5, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
const wordpressPostsUrl = 'https://otomotifzone.com/wp-json/wp/v2/posts';
let ingestionSyncPromise = null;

const respond = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const integer = (v) => /^-?\d+$/.test(String(v ?? '')) ? String(v) : null;
const uuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? '')) ? String(v) : null;
const bad = (message) => { const e = new Error(message); e.httpStatus = 400; throw e; };

async function bodyJson(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 128 * 1024) bad('Request terlalu besar.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return bad('JSON tidak valid.'); }
}

async function syncIngestion() {
  if (ingestionSyncPromise) return ingestionSyncPromise;
  ingestionSyncPromise = (async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(7900260926) AS locked');
      if (!lock.rows[0].locked) { await client.query('ROLLBACK'); return { busy: true, inserted: 0 }; }
      const state = await client.query('SELECT * FROM oz_approval.ingestion_state WHERE singleton=TRUE FOR UPDATE');
      const watermark = state.rows[0]?.watermark_post_id ? String(state.rows[0].watermark_post_id) : null;
      const collected = [];
      let newest = null, foundWatermark = false, totalPages = 1;
      for (let page = 1; page <= Math.min(totalPages, 200); page++) {
        const url = new URL(wordpressPostsUrl);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        url.searchParams.set('orderby', 'date');
        url.searchParams.set('order', 'desc');
        url.searchParams.set('_embed', '1');
        const response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { 'user-agent': 'OtomotifZone-n8n-ingestion/1.0' } });
        if (!response.ok) throw new Error(`WordPress API ${response.status} pada halaman ${page}`);
        totalPages = Math.max(1, Number(response.headers.get('x-wp-totalpages') || 1));
        const posts = await response.json();
        if (!Array.isArray(posts) || !posts.length) break;
        if (!newest) newest = posts[0];
        if (!watermark) { foundWatermark = true; break; }
        for (const post of posts) {
          if (String(post.id) === watermark) { foundWatermark = true; break; }
          collected.push(post);
        }
        if (foundWatermark) break;
        if (page === 200 && totalPages > 200) throw new Error('Backlog melebihi 20.000 artikel; sinkronisasi dihentikan untuk pemeriksaan.');
      }
      if (watermark && !foundWatermark) throw new Error('Watermark artikel lama tidak ditemukan; antrean tidak dimajukan agar artikel tidak terlewat.');
      for (const post of collected) {
        const publishedAt = post.date_gmt || post.date || new Date().toISOString();
        await client.query(`INSERT INTO oz_approval.ingestion_articles(post_id,article_json,published_at)
          VALUES ($1,$2,$3) ON CONFLICT (post_id) DO UPDATE SET article_json=EXCLUDED.article_json, updated_at=now()
          WHERE oz_approval.ingestion_articles.state IN ('pending','leased')`, [post.id, post, publishedAt]);
      }
      if (newest?.id) await client.query(`UPDATE oz_approval.ingestion_state SET
        watermark_post_id=$1,last_synced_at=now(),last_error=NULL,updated_at=now() WHERE singleton=TRUE`, [newest.id]);
      await client.query('COMMIT');
      return { busy: false, inserted: collected.length, watermark_post_id: newest?.id || watermark };
    } catch (error) {
      await client.query('ROLLBACK');
      await db.query(`UPDATE oz_approval.ingestion_state SET last_error=$1,updated_at=now() WHERE singleton=TRUE`, [clean(error.message, 1000)]).catch(() => {});
      throw error;
    } finally { client.release(); }
  })();
  try { return await ingestionSyncPromise; } finally { ingestionSyncPromise = null; }
}

async function claimIngestion() {
  const sync = await syncIngestion();
  const q = await db.query(`WITH candidate AS (
      SELECT post_id FROM oz_approval.ingestion_articles
      WHERE state='pending' OR (state='leased' AND lease_until < now())
      ORDER BY published_at ASC, post_id ASC FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE oz_approval.ingestion_articles a SET
      state='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '20 minutes',
      attempts=attempts+1,last_error=NULL,updated_at=now()
    FROM candidate c WHERE a.post_id=c.post_id
    RETURNING a.*`);
  if (!q.rowCount) return { has_article: false, sync };
  return { has_article: true, article: q.rows[0].article_json, lease_token: q.rows[0].lease_token, attempts: q.rows[0].attempts, sync };
}

async function completeIngestion(b) {
  const token = uuid(b.lease_token);
  const postId = integer(b.post_id);
  if (!token || !postId) bad('Lease artikel tidak valid.');
  const q = await db.query(`UPDATE oz_approval.ingestion_articles SET
    state='completed',lease_until=NULL,last_error=NULL,updated_at=now()
    WHERE post_id=$1 AND lease_token=$2 AND state='leased' RETURNING post_id`, [postId, token]);
  if (!q.rowCount) {
    const old = await db.query('SELECT state FROM oz_approval.ingestion_articles WHERE post_id=$1', [postId]);
    return { completed: old.rows[0]?.state === 'completed', already_completed: old.rows[0]?.state === 'completed' };
  }
  return { completed: true, already_completed: false };
}

async function ingestionStatus() {
  const state = await db.query('SELECT * FROM oz_approval.ingestion_state WHERE singleton=TRUE');
  const counts = await db.query(`SELECT state,count(*)::int AS count,min(published_at) AS oldest
    FROM oz_approval.ingestion_articles GROUP BY state ORDER BY state`);
  return { state: state.rows[0], queue: counts.rows };
}

const publicRow = (r) => r && ({
  post_id: String(r.post_id), design_version: r.design_version, version_no: r.version_no,
  parent_version: r.parent_version, status: r.status, decision_action: r.decision_action,
  decided_by_user_id: r.decided_by_user_id && String(r.decided_by_user_id),
  decided_by_name: r.decided_by_name, decided_by_username: r.decided_by_username,
  decided_at: r.decided_at, approval_group_chat_id: String(r.approval_group_chat_id),
  approval_photo_message_id: r.approval_photo_message_id && String(r.approval_photo_message_id),
  approval_message_id: r.approval_message_id && String(r.approval_message_id),
  notification_channel_chat_id: String(r.notification_channel_chat_id),
  channel_message_id: r.channel_message_id && String(r.channel_message_id),
  telegram_photo_file_id: r.telegram_photo_file_id,
  instagram_container_id: r.instagram_container_id,
  instagram_media_id: r.instagram_media_id,
  instagram_permalink: r.instagram_permalink,
  instagram_published_at: r.instagram_published_at,
  content: r.content_json,
});

async function prepare(b) {
  const postId = integer(b.post_id);
  if (!postId || BigInt(postId) === 0n) bad('post_id tidak valid.');
  const parentVersion = b.parent_version ? uuid(b.parent_version) : null;
  if (b.parent_version && !parentVersion) bad('parent_version tidak valid.');
  const content = {
    article_title: clean(b.article_title || b.headline, 300),
    headline: clean(b.headline, 150), subheadline: clean(b.subheadline, 300),
    caption: clean(b.caption, 3000), author: clean(b.author, 120),
    category: clean(b.category, 120), article_url: clean(b.article_url, 1000),
    photo_url: clean(b.photo_url, 1000),
    revision_note: clean(b.revision_note, 1000),
    instagram_image_url: clean(b.instagram_image_url, 1000),
    validation_warnings: Array.isArray(b.validation_warnings) ? b.validation_warnings.map(x => clean(x, 300)).slice(0, 20) : [],
    verification_status: ['PASS', 'WARNING', 'FAIL'].includes(clean(b.verification_status, 20).toUpperCase())
      ? clean(b.verification_status, 20).toUpperCase() : 'WARNING',
    verification_summary: clean(b.verification_summary, 300),
    verification_checks: Array.isArray(b.verification_checks) ? b.verification_checks.slice(0, 8).map(x => ({
      claim_type: clean(x?.claim_type, 40), claim: clean(x?.claim, 220),
      source_quote: clean(x?.source_quote, 300),
      result: ['PASS', 'WARNING', 'FAIL'].includes(clean(x?.result, 20).toUpperCase()) ? clean(x.result, 20).toUpperCase() : 'WARNING',
      evidence_exact: x?.evidence_exact === true,
    })) : [],
    ...resolveCollaborators(b.source_author || b.author, collaboratorConfig),
  };
  if (!content.headline || !content.subheadline || !content.caption || !content.article_url) bad('Konten approval belum lengkap.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [postId]);
    let existing, versionNo;
    if (parentVersion) {
      const parent = await client.query('SELECT * FROM oz_approval.decisions WHERE post_id=$1 AND design_version=$2', [postId, parentVersion]);
      if (!parent.rowCount || !['revision_requested', 'rendering'].includes(parent.rows[0].status)) bad('Versi induk tidak siap untuk revisi/render ulang.');
      existing = await client.query('SELECT * FROM oz_approval.decisions WHERE parent_version=$1', [parentVersion]);
      versionNo = parent.rows[0].version_no + 1;
    } else {
      existing = await client.query('SELECT * FROM oz_approval.decisions WHERE post_id=$1 ORDER BY version_no DESC LIMIT 1', [postId]);
      versionNo = 1;
    }
    if (existing.rowCount) {
      await client.query('COMMIT');
      return { created: false, decision: publicRow(existing.rows[0]) };
    }
    const inserted = await client.query(`
      INSERT INTO oz_approval.decisions
      (post_id, version_no, parent_version, status, approval_group_chat_id, notification_channel_chat_id, content_json)
      VALUES ($1,$2,$3,'preparing',$4,$5,$6) RETURNING *`,
      [postId, versionNo, parentVersion, groupId, channelId, content]);
    await client.query('COMMIT');
    return { created: true, decision: publicRow(inserted.rows[0]) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function attachPhoto(b) {
  const version = uuid(b.design_version), id = integer(b.photo_message_id), fileId = clean(b.telegram_photo_file_id, 300);
  if (!version || !id || !fileId) bad('Referensi foto tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions
    SET approval_photo_message_id=$2, telegram_photo_file_id=$3, updated_at=now()
    WHERE design_version=$1 AND status='preparing' AND approval_photo_message_id IS NULL RETURNING *`, [version, id, fileId]);
  if (q.rowCount) return { stored: true, decision: publicRow(q.rows[0]) };
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
  return { stored: false, decision: publicRow(old.rows[0]) };
}

async function ready(b) {
  const version = uuid(b.design_version), id = integer(b.approval_message_id);
  if (!version || !id) bad('Referensi pesan approval tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions
    SET approval_message_id=$2, status='waiting_approval', updated_at=now()
    WHERE design_version=$1 AND status='preparing' AND approval_message_id IS NULL
      AND telegram_photo_file_id IS NOT NULL
      AND COALESCE(content_json->>'instagram_image_url','') <> '' RETURNING *`, [version, id]);
  if (q.rowCount) return { stored: true, decision: publicRow(q.rows[0]) };
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
  return { stored: false, decision: publicRow(old.rows[0]) };
}

async function claim(b) {
  const postId = integer(b.post_id), version = uuid(b.design_version);
  const chatId = integer(b.approval_group_chat_id), messageId = integer(b.approval_message_id);
  const userId = integer(b.decided_by_user_id), messageBotId = integer(b.message_from_bot_id);
  const action = clean(b.decision_action, 20);
  const statuses = { approve: 'approved', revise: 'revision_requested', rerender: 'rendering', skip: 'skipped' };
  if (!postId || !version || !chatId || !messageId || !userId || !messageBotId || !statuses[action]) bad('Data callback tidak valid.');
  if (chatId !== groupId || messageBotId !== botId || b.message_from_is_bot !== true) return { valid: false, won: false, reason: 'Sumber callback tidak sah.' };
  const fullName = clean(b.decided_by_name, 200);
  const username = clean(b.decided_by_username, 100);
  const displayName = fullName || (username ? `@${username}` : userId);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const won = await client.query(`UPDATE oz_approval.decisions SET
      status=$5, decision_action=$6, decided_by_user_id=$7,
      decided_by_name=$8, decided_by_username=$9, decided_at=now(),
      content_json=CASE WHEN $6='revise' THEN
        jsonb_set(content_json,'{revision_mode}','"awaiting_choice"'::jsonb,true)
        ELSE content_json END, updated_at=now()
      WHERE post_id=$1 AND design_version=$2 AND approval_group_chat_id=$3
        AND approval_message_id=$4 AND status='waiting_approval' RETURNING *`,
      [postId, version, chatId, messageId, statuses[action], action, userId, displayName, username || null]);
    if (won.rowCount) {
      const outboxAction = { approve: 'channel', rerender: 'rerender' }[action];
      if (outboxAction) await client.query(`INSERT INTO oz_approval.outbox (post_id,design_version,action)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [postId, version, outboxAction]);
      await client.query('COMMIT');
      return { valid: true, won: true, decision: publicRow(won.rows[0]) };
    }
    const old = await client.query(`SELECT * FROM oz_approval.decisions
      WHERE post_id=$1 AND design_version=$2 AND approval_group_chat_id=$3 AND approval_message_id=$4`,
      [postId, version, chatId, messageId]);
    await client.query('COMMIT');
    return { valid: !!old.rowCount, won: false, decision: publicRow(old.rows[0]) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function revisionMenu(b) {
  const version = uuid(b.design_version), messageId = integer(b.menu_message_id);
  if (!version || !messageId) bad('Pesan pilihan revisi tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions SET
    content_json=jsonb_set(content_json,'{revision_menu_message_id}',to_jsonb($2::text),true),updated_at=now()
    WHERE design_version=$1 AND status='revision_requested' AND decision_action='revise'
      AND content_json->>'revision_mode'='awaiting_choice'
      AND content_json->>'revision_menu_message_id' IS NULL RETURNING *`,[version,messageId]);
  if (q.rowCount) return { stored:true, decision:publicRow(q.rows[0]) };
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1',[version]);
  return { stored:false, decision:publicRow(old.rows[0]) };
}

async function revisionChoice(b) {
  const version = uuid(b.design_version), chatId = integer(b.approval_group_chat_id);
  const messageId = integer(b.menu_message_id), userId = integer(b.user_id);
  const messageBotId = integer(b.message_from_bot_id), choice = clean(b.choice,20);
  if (!version || !chatId || !messageId || !userId || !messageBotId || !['automatic','guided'].includes(choice)) bad('Pilihan revisi tidak valid.');
  if (chatId !== groupId || messageBotId !== botId || b.message_from_is_bot !== true) return {valid:false,won:false};
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const next = choice === 'automatic' ? 'automatic' : 'awaiting_prompt';
    const won = await client.query(`UPDATE oz_approval.decisions SET
      content_json=jsonb_set(jsonb_set(content_json,'{revision_mode}',to_jsonb($5::text),true),
        '{revision_menu_message_id}',to_jsonb($4::text),true),updated_at=now()
      WHERE design_version=$1 AND approval_group_chat_id=$2 AND decided_by_user_id=$3
        AND (content_json->>'revision_menu_message_id'=$4 OR content_json->>'revision_menu_message_id' IS NULL)
        AND status='revision_requested' AND decision_action='revise'
        AND content_json->>'revision_mode'='awaiting_choice' RETURNING *`,
      [version,chatId,userId,messageId,next]);
    if (won.rowCount && choice === 'automatic') await client.query(`INSERT INTO oz_approval.outbox(post_id,design_version,action)
      VALUES($1,$2,'revise') ON CONFLICT DO NOTHING`,[won.rows[0].post_id,version]);
    const old = won.rowCount ? won : await client.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1',[version]);
    await client.query('COMMIT');
    return {valid:!!old.rowCount,won:!!won.rowCount,decision:publicRow(old.rows[0])};
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function revisionPrompt(b) {
  const version = uuid(b.design_version), messageId = integer(b.prompt_message_id);
  if (!version || !messageId) bad('Pesan arahan revisi tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions SET
    content_json=jsonb_set(jsonb_set(content_json,'{revision_prompt_message_id}',to_jsonb($2::text),true),
      '{revision_mode}','"awaiting_note"'::jsonb,true),updated_at=now()
    WHERE design_version=$1 AND status='revision_requested' AND decision_action='revise'
      AND content_json->>'revision_mode'='awaiting_prompt'
      AND content_json->>'revision_prompt_message_id' IS NULL RETURNING *`,[version,messageId]);
  if (q.rowCount) return {stored:true,decision:publicRow(q.rows[0])};
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1',[version]);
  return {stored:false,decision:publicRow(old.rows[0])};
}

async function revisionNote(b) {
  const chatId = integer(b.approval_group_chat_id), userId = integer(b.user_id);
  const promptId = integer(b.reply_to_message_id), noteMessageId = integer(b.note_message_id);
  const messageBotId = integer(b.reply_to_bot_id);
  const note = clean(b.note,1000).replace(/\s+/g,' ').trim();
  if (!chatId || !userId || !promptId || !noteMessageId || !messageBotId) bad('Balasan revisi tidak valid.');
  if (chatId !== groupId || messageBotId !== botId || b.reply_to_is_bot !== true || b.from_is_bot === true)
    return {valid:false,won:false};
  if (note.length < 5 || String(b.note ?? '').length > 1000) return {valid:false,won:false,reason:'Arahan perlu 5–1000 karakter teks.'};
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const won = await client.query(`UPDATE oz_approval.decisions SET
      content_json=jsonb_set(jsonb_set(jsonb_set(content_json,'{revision_mode}','"guided_ready"'::jsonb,true),
        '{revision_note}',to_jsonb($4::text),true),'{revision_note_message_id}',to_jsonb($5::text),true),
      updated_at=now()
      WHERE approval_group_chat_id=$1 AND decided_by_user_id=$2
        AND content_json->>'revision_prompt_message_id'=$3
        AND status='revision_requested' AND decision_action='revise'
        AND content_json->>'revision_mode'='awaiting_note' RETURNING *`,
      [chatId,userId,promptId,note,noteMessageId]);
    if (won.rowCount) await client.query(`INSERT INTO oz_approval.outbox(post_id,design_version,action)
      VALUES($1,$2,'revise') ON CONFLICT DO NOTHING`,[won.rows[0].post_id,won.rows[0].design_version]);
    await client.query('COMMIT');
    return {valid:!!won.rowCount,won:!!won.rowCount,decision:publicRow(won.rows[0])};
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function reserve(b) {
  const version = uuid(b.design_version);
  const action = clean(b.action, 20);
  if (!version || !['channel', 'revise', 'rerender'].includes(action)) bad('Tugas tidak valid.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`UPDATE oz_approval.outbox SET state='sending', attempts=attempts+1, updated_at=now()
      WHERE design_version=$1 AND action=$2 AND state='queued' RETURNING *`, [version, action]);
    if (q.rowCount && action === 'channel') await client.query(`UPDATE oz_approval.decisions SET status='publishing', updated_at=now()
      WHERE design_version=$1 AND status='approved'`, [version]);
    const decision = await client.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
    await client.query('COMMIT');
    return { reserved: !!q.rowCount, decision: publicRow(decision.rows[0]) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function channelSent(b) {
  const version = uuid(b.design_version), msgId = integer(b.channel_message_id);
  if (!version || !msgId) bad('Pesan channel tidak valid.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`UPDATE oz_approval.outbox SET state='sent', updated_at=now()
      WHERE design_version=$1 AND action='channel' AND state='sending' RETURNING *`, [version]);
    if (q.rowCount) await client.query(`UPDATE oz_approval.decisions
      SET status=CASE WHEN instagram_media_id IS NOT NULL THEN 'published' ELSE 'channel_sent' END,
        channel_message_id=$2, updated_at=now()
      WHERE design_version=$1 AND status='publishing'`, [version, msgId]);
    const d = await client.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
    await client.query('COMMIT');
    return { stored: !!q.rowCount, decision: publicRow(d.rows[0]) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function instagramContainer(b) {
  const version = uuid(b.design_version), containerId = integer(b.instagram_container_id);
  if (!version || !containerId) bad('Container Instagram tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions
    SET instagram_container_id=$2,
      content_json=jsonb_set(jsonb_set(content_json,'{final_collaborators}',
        COALESCE(content_json->'requested_collaborators','[]'::jsonb),true),
        '{collaboration_status}','"NOT_SENT"'::jsonb,true), updated_at=now()
    WHERE design_version=$1 AND status='publishing' AND instagram_container_id IS NULL
    RETURNING *`, [version, containerId]);
  if (q.rowCount) return { stored: true, decision: publicRow(q.rows[0]) };
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
  return { stored: false, decision: publicRow(old.rows[0]) };
}

async function collaborationError(b) {
  const version = uuid(b.design_version);
  if (!version) bad('Versi keputusan tidak valid.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`UPDATE oz_approval.decisions SET status='failed',
      content_json=jsonb_set(jsonb_set(content_json,'{collaboration_status}','"FAILED"'::jsonb,true),
        '{collaboration_error}',to_jsonb('Meta menolak pembuatan container dengan collaborator; perlu pemeriksaan manual.'::text),true),
      updated_at=now()
      WHERE design_version=$1 AND status='publishing' AND instagram_container_id IS NULL
        AND instagram_media_id IS NULL RETURNING *`, [version]);
    if (q.rowCount) await client.query(`UPDATE oz_approval.outbox SET state='failed',
      last_error='Instagram collaborator container rejected; manual review required',updated_at=now()
      WHERE design_version=$1 AND action='channel' AND state='sending'`, [version]);
    await client.query('COMMIT');
    return { stored: !!q.rowCount, decision: publicRow(q.rows[0]) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

async function instagramPublished(b) {
  const version = uuid(b.design_version), mediaId = integer(b.instagram_media_id);
  const permalink = clean(b.instagram_permalink, 1000);
  if (!version || !mediaId || !/^https:\/\/www\.instagram\.com\//i.test(permalink)) bad('Hasil publikasi Instagram tidak valid.');
  const q = await db.query(`UPDATE oz_approval.decisions
    SET instagram_media_id=$2, instagram_permalink=$3, instagram_published_at=now(),
      content_json=jsonb_set(content_json,'{collaboration_status}',
        CASE WHEN jsonb_array_length(COALESCE(content_json->'final_collaborators','[]'::jsonb))>0
          THEN '"PENDING"'::jsonb ELSE '"NOT_SENT"'::jsonb END,true), updated_at=now()
    WHERE design_version=$1 AND status='publishing' AND instagram_media_id IS NULL
    RETURNING *`, [version, mediaId, permalink]);
  if (q.rowCount) return { stored: true, decision: publicRow(q.rows[0]) };
  const old = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
  return { stored: false, decision: publicRow(old.rows[0]) };
}

async function linkBioPublished(b) {
  const version = uuid(b.design_version);
  if (!version) bad('Versi link-in-bio tidak valid.');
  const q = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
  if (!q.rowCount) bad('Keputusan approval tidak ditemukan.');
  const decision = q.rows[0];
  const content = decision.content_json || {};
  if (decision.decision_action !== 'approve' || !['publishing','published'].includes(decision.status)) {
    bad('Konten belum berada pada tahap publikasi yang sah.');
  }
  if (!decision.instagram_media_id || !decision.instagram_permalink || !decision.instagram_published_at) {
    bad('Publikasi Instagram belum lengkap.');
  }
  const item = await db.query(`SELECT * FROM oz_linkbio.publish_item(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
  )`, [
    decision.post_id,
    decision.design_version,
    clean(content.article_title || content.headline, 300),
    clean(content.article_url, 1000),
    clean(content.instagram_image_url, 1000),
    clean(`Desain berita: ${content.headline || content.article_title}`, 500),
    clean(content.caption, 3000),
    clean(content.category, 120) || null,
    clean(content.author, 120) || null,
    decision.decided_by_user_id ? String(decision.decided_by_user_id) : null,
    clean(decision.decided_by_name, 200) || null,
    decision.decided_at,
    decision.instagram_container_id,
    decision.instagram_media_id,
    decision.instagram_permalink,
    decision.instagram_published_at,
  ]);
  const stored = item.rows[0];
  return {
    stored: true,
    item: {
      wp_post_id: String(stored.wp_post_id),
      design_version: stored.design_version,
      gallery_status: stored.gallery_status,
      article_url: stored.article_url,
      instagram_media_id: stored.instagram_media_id,
    },
    decision: publicRow(decision),
  };
}

async function reworkDone(b) {
  const version = uuid(b.design_version), action = clean(b.action, 20);
  if (!version || !['revise', 'rerender'].includes(action)) bad('Tugas revisi tidak valid.');
  const q = await db.query(`UPDATE oz_approval.outbox SET state='sent', updated_at=now()
    WHERE design_version=$1 AND action=$2 AND state='sending' RETURNING *`, [version, action]);
  return { stored: !!q.rowCount };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      await db.query('SELECT 1'); return respond(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url?.startsWith('/decision?')) {
      const version = uuid(new URL(req.url, 'http://local').searchParams.get('version'));
      if (!version) bad('Versi tidak valid.');
      const q = await db.query('SELECT * FROM oz_approval.decisions WHERE design_version=$1', [version]);
      return respond(res, q.rowCount ? 200 : 404, { decision: publicRow(q.rows[0]) });
    }
    if (req.method === 'GET' && req.url === '/outbox/queued') {
      const q = await db.query(`SELECT d.* FROM oz_approval.outbox o
        JOIN oz_approval.decisions d USING (post_id, design_version)
        WHERE o.state='queued' AND o.action IN ('channel','revise','rerender')
        ORDER BY o.created_at ASC LIMIT 1`);
      return respond(res, 200, { tasks: q.rows.map(r => ({ won: true, decision: publicRow(r) })) });
    }
    if (req.method === 'GET' && req.url === '/ingestion/status') {
      return respond(res, 200, await ingestionStatus());
    }
    if (req.method !== 'POST') return respond(res, 404, { error: 'Endpoint tidak ditemukan.' });
    const b = await bodyJson(req);
    const routes = {
      '/prepare': prepare, '/attach-photo': attachPhoto, '/ready': ready,
      '/claim': claim, '/revision/menu': revisionMenu,
      '/revision/choice': revisionChoice, '/revision/prompt': revisionPrompt,
      '/revision/note': revisionNote, '/reserve': reserve, '/channel-sent': channelSent,
      '/instagram-container': instagramContainer, '/collaboration-error': collaborationError,
      '/instagram-published': instagramPublished,
      '/linkbio-published': linkBioPublished,
      '/rework-done': reworkDone,
      '/ingestion/claim': claimIngestion,
      '/ingestion/complete': completeIngestion,
      '/ingestion/bootstrap': syncIngestion,
    };
    const fn = routes[req.url];
    if (!fn) return respond(res, 404, { error: 'Endpoint tidak ditemukan.' });
    return respond(res, 200, await fn(b));
  } catch (error) {
    console.error('Approval service error:', error.message);
    return respond(res, error.httpStatus || 500, { error: error.httpStatus ? error.message : 'Kesalahan layanan approval.' });
  }
});

server.listen(port, '0.0.0.0');

// A Telegram send can succeed even if its reply never reaches n8n. Do not retry an
// ambiguous send automatically: record it for manual reconciliation instead.
setInterval(async () => {
  try {
    // Safe automatic recovery before a persistent external identifier exists.
    // An orphan Instagram container is harmless because it was never published.
    await db.query(`UPDATE oz_approval.outbox o SET state='queued',
      last_error='Retry otomatis aman sebelum publikasi eksternal tercatat.',updated_at=now()
      FROM oz_approval.decisions d
      WHERE o.post_id=d.post_id AND o.design_version=d.design_version
        AND o.state='sending' AND o.updated_at < now()-interval '10 minutes'
        AND o.action='channel' AND d.instagram_container_id IS NULL`);
    await db.query(`UPDATE oz_approval.outbox o SET state='queued',
      last_error='Retry otomatis aman sebelum versi pengganti dibuat.',updated_at=now()
      WHERE o.state='sending' AND o.updated_at < now()-interval '10 minutes'
        AND o.action IN ('revise','rerender')
        AND NOT EXISTS (SELECT 1 FROM oz_approval.decisions child WHERE child.parent_version=o.design_version)`);
    const stale = await db.query(`UPDATE oz_approval.outbox SET state='unknown',
      last_error='Hasil pengiriman belum pasti; perlu pemeriksaan manual sebelum mencoba lagi.',
      updated_at=now()
      WHERE state='sending' AND updated_at < now() - interval '10 minutes'
      RETURNING design_version, action`);
    for (const task of stale.rows) {
      await db.query(`UPDATE oz_approval.decisions SET status=$2, updated_at=now()
        WHERE design_version=$1 AND status IN ('publishing','revision_requested','rendering')`,
        [task.design_version, task.action === 'channel' ? 'publishing_unknown' : 'failed']);
    }
  } catch (error) { console.error('Approval watchdog:', error.message); }
}, 60_000).unref();
