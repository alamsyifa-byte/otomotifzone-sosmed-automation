import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 3002);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const css = await readFile(path.join(publicDir, 'styles.css'));
const logo = await readFile(path.join(publicDir, 'logo.png'));
const appJs = await readFile(path.join(publicDir, 'app.js'));
const dashboardCss = await readFile(path.join(publicDir, 'dashboard.css'));

const site = {
  name: process.env.SITE_NAME || 'OtomotifZone',
  handle: process.env.SITE_HANDLE || 'otomotifzone',
  description: process.env.SITE_DESCRIPTION || 'Akun resmi OtomotifZone',
  websiteUrl: process.env.WEBSITE_URL || 'https://otomotifzone.com/',
  youtubeUrl: process.env.YOUTUBE_URL || '',
  bagibagiUrl: process.env.BAGIBAGI_URL || '',
  saweriaUrl: process.env.SAWERIA_URL || '',
  publicUrl: process.env.PUBLIC_URL || 'https://link.139-190-98-210.sslip.io/',
  ogImageUrl: process.env.OG_IMAGE_URL || 'https://otomotifzone.com/wp-content/uploads/2025/03/logo-otomotifzone.png',
};
const analyticsSecret = process.env.ANALYTICS_SECRET || '';
const dashboardUser = process.env.DASHBOARD_USERNAME || '';
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const recentEvents = new Map();

const db = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 4,
  idleTimeoutMillis: 30_000,
});

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeUrl = (value = '') => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
};

async function visibleItems() {
  const result = await db.query(`
    SELECT wp_post_id, design_version, article_title, article_url,
           COALESCE(thumbnail_url, image_url) AS display_image_url,
           alt_text, instagram_permalink, instagram_published_at, visible_at
    FROM oz_linkbio.items
    WHERE approval_status = 'approved'
      AND instagram_status = 'published'
      AND gallery_status = 'visible'
    ORDER BY visible_at DESC, id DESC
    LIMIT 120
  `);
  return result.rows;
}

function fixedButton(label, url, icon) {
  const href = safeUrl(url);
  if (!href) {
    return `<span class="main-button is-disabled" aria-disabled="true"><span>${icon}</span>${escapeHtml(label)}<small>Tautan menyusul</small></span>`;
  }
  const kind = label.startsWith('Website') ? 'website' : 'youtube';
  return `<a class="main-button" href="${escapeHtml(href)}" data-track-kind="${kind}" rel="noopener noreferrer"><span>${icon}</span>${escapeHtml(label)}</a>`;
}

const bounded = (value, max = 100) => String(value || '').trim().slice(0, max) || null;

function isBot(req) {
  return /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slurp/i.test(String(req.headers['user-agent'] || ''));
}

function visitorHash(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req.socket.remoteAddress || 'unknown';
  const agent = String(req.headers['user-agent'] || 'unknown');
  const day = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', analyticsSecret).update(`${day}|${address}|${agent}`).digest('hex').slice(0, 32);
}

function clientKind(req) {
  return /mobile|android|iphone|ipad/i.test(String(req.headers['user-agent'] || '')) ? 'mobile' : 'desktop';
}

function referrerHost(value) {
  try { return bounded(new URL(value).hostname, 160); } catch { return null; }
}

async function recordEvent(req, event) {
  if (!analyticsSecret || isBot(req)) return;
  const hash = visitorHash(req);
  const key = `${hash}|${event.eventType}|${event.linkKind || ''}|${event.wpPostId || ''}|${event.designVersion || ''}`;
  const now = Date.now();
  if (now - (recentEvents.get(key) || 0) < 1_500) return;
  recentEvents.set(key, now);
  if (recentEvents.size > 5_000) {
    for (const [oldKey, seenAt] of recentEvents) if (now - seenAt > 60_000) recentEvents.delete(oldKey);
  }

  if (event.linkKind === 'article') {
    const valid = await db.query(`SELECT 1 FROM oz_linkbio.items
      WHERE wp_post_id=$1 AND design_version=$2
        AND approval_status='approved' AND instagram_status='published' AND gallery_status='visible'`,
    [event.wpPostId, event.designVersion]);
    if (!valid.rowCount) return;
  }

  await db.query(`INSERT INTO oz_linkbio.events
    (event_type,link_kind,wp_post_id,design_version,visitor_hash,client_kind,referrer_host,utm_source,utm_medium,utm_campaign)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
    event.eventType,
    event.linkKind || null,
    event.wpPostId || null,
    event.designVersion || null,
    hash,
    clientKind(req),
    referrerHost(event.referrer || req.headers.referer),
    bounded(event.utmSource),
    bounded(event.utmMedium),
    bounded(event.utmCampaign),
  ]);
}

async function readSmallJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_048) throw new Error('Payload terlalu besar');
  }
  return JSON.parse(body || '{}');
}

function page(items) {
  const cards = items.length ? items.map((item, index) => {
    const title = escapeHtml(item.article_title);
    const articleUrl = escapeHtml(safeUrl(item.article_url));
    const imageUrl = escapeHtml(safeUrl(item.display_image_url));
    const alt = escapeHtml(item.alt_text || item.article_title);
    return `<a class="news-card" href="${articleUrl}" data-track-kind="article" data-post-id="${item.wp_post_id}" data-design-version="${escapeHtml(item.design_version)}" aria-label="Buka artikel: ${title}">
      <span class="image-fallback" aria-hidden="true">${title}</span>
      <img src="${imageUrl}" alt="${alt}" width="540" height="675" ${index < 6 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      <span class="screen-reader-only">Buka artikel ${title} di OtomotifZone.com</span>
    </a>`;
  }).join('\n') : '<p class="empty-state">Belum ada berita yang sudah dipublikasikan.</p>';

  const instagramIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" class="dot"/></svg>';
  const youtubeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 7.2a3 3 0 0 0-2.1-2.1C17 4.6 12 4.6 12 4.6s-5 0-6.9.5A3 3 0 0 0 3 7.2 31 31 0 0 0 2.5 12 31 31 0 0 0 3 16.8a3 3 0 0 0 2.1 2.1c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8Z"/><path d="m10 15.3 5.2-3.3L10 8.7Z" class="play"/></svg>';

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#111111">
  <meta name="description" content="Berita otomotif terbaru dari OtomotifZone. Pilih gambar untuk membaca artikel lengkap.">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="id_ID">
  <meta property="og:site_name" content="OtomotifZone">
  <meta property="og:title" content="OtomotifZone — Link Berita">
  <meta property="og:description" content="Berita otomotif terbaru dari OtomotifZone. Pilih gambar untuk membaca artikel lengkap.">
  <meta property="og:url" content="${escapeHtml(safeUrl(site.publicUrl))}">
  <meta property="og:image" content="${escapeHtml(safeUrl(site.ogImageUrl))}">
  <meta property="og:image:secure_url" content="${escapeHtml(safeUrl(site.ogImageUrl))}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="622">
  <meta property="og:image:height" content="678">
  <meta property="og:image:alt" content="Logo OtomotifZone">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="OtomotifZone — Link Berita">
  <meta name="twitter:description" content="Berita otomotif terbaru dari OtomotifZone.">
  <meta name="twitter:image" content="${escapeHtml(safeUrl(site.ogImageUrl))}">
  <link rel="canonical" href="${escapeHtml(safeUrl(site.publicUrl))}">
  <title>${escapeHtml(site.name)} — Link Berita</title>
  <link rel="stylesheet" href="/assets/styles.css?v=20260925-3">
  <script src="/assets/app.js?v=20260925-1" defer></script>
</head>
<body>
  <main class="page-shell">
    <header class="profile">
      <img class="profile-logo" src="/assets/logo.png" width="87" height="98" alt="Logo OtomotifZone">
      <h1>${escapeHtml(site.handle)}</h1>
      <p>${escapeHtml(site.description)}</p>
      <nav class="social-links" aria-label="Media sosial OtomotifZone">
        <a href="https://www.instagram.com/otomotifzone_official/" data-track-kind="instagram" aria-label="Instagram OtomotifZone" rel="noopener noreferrer">${instagramIcon}</a>
        <a href="${escapeHtml(safeUrl(site.youtubeUrl))}" data-track-kind="youtube" aria-label="YouTube OtomotifZone" rel="noopener noreferrer">${youtubeIcon}</a>
      </nav>
    </header>

    <nav class="main-links" aria-label="Tautan utama">
      ${fixedButton('Website Resmi OtomotifZone', site.websiteUrl, '↗')}
      ${fixedButton('Live Streaming & YouTube', site.youtubeUrl, '▶')}
      <details class="donate-menu">
        <summary class="main-button"><span>♥</span>Donate & Saweria</summary>
        <div class="donate-options">
          <a href="${escapeHtml(safeUrl(site.bagibagiUrl))}" data-track-kind="bagibagi" rel="noopener noreferrer">Bagibagi</a>
          <a href="${escapeHtml(safeUrl(site.saweriaUrl))}" data-track-kind="saweria" rel="noopener noreferrer">Saweria</a>
        </div>
      </details>
    </nav>

    <section class="latest" aria-labelledby="latest-title">
      <div class="section-heading">
        <h2 id="latest-title">Berita terbaru</h2>
        <span>${items.length} tautan</span>
      </div>
      <div class="news-grid">${cards}</div>
    </section>

    <footer>
      <a href="https://otomotifzone.com/">OtomotifZone.com</a>
    </footer>
  </main>
</body>
</html>`;
}

function dashboardAuthorized(req) {
  if (!dashboardUser || !dashboardPassword) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const user = Buffer.from(decoded.slice(0, split));
  const pass = Buffer.from(decoded.slice(split + 1));
  const expectedUser = Buffer.from(dashboardUser);
  const expectedPass = Buffer.from(dashboardPassword);
  return user.length === expectedUser.length && pass.length === expectedPass.length
    && timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass);
}

const fmt = (value) => new Intl.NumberFormat('id-ID').format(Number(value || 0));
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

async function dashboardPage() {
  const [summary, daily, links, articles, ops, failures] = await Promise.all([
    db.query(`SELECT
      count(*) FILTER (WHERE event_type='page_view')::int page_views,
      count(DISTINCT visitor_hash) FILTER (WHERE event_type='page_view')::int visitors,
      count(*) FILTER (WHERE event_type='link_click')::int clicks
      FROM oz_linkbio.events WHERE occurred_at >= now()-interval '30 days'`),
    db.query(`WITH days AS (SELECT generate_series(current_date-29,current_date,'1 day')::date d)
      SELECT d,coalesce(a.page_views,0)::int page_views,coalesce(a.unique_visitors,0)::int visitors,
      coalesce(a.total_clicks,0)::int clicks FROM days LEFT JOIN oz_linkbio.analytics_daily a ON a.event_date=d ORDER BY d`),
    db.query(`SELECT coalesce(link_kind,'lainnya') link_kind,count(*)::int clicks
      FROM oz_linkbio.events WHERE event_type='link_click' AND occurred_at>=now()-interval '30 days'
      GROUP BY 1 ORDER BY 2 DESC`),
    db.query(`SELECT article_title,article_url,clicks,unique_clickers,last_clicked_at
      FROM oz_linkbio.analytics_articles ORDER BY clicks DESC,last_clicked_at DESC NULLS LAST LIMIT 15`),
    db.query(`SELECT
      (SELECT count(*) FROM oz_approval.ingestion_articles WHERE state='pending')::int queue_pending,
      (SELECT count(*) FROM oz_approval.ingestion_articles WHERE state='leased')::int queue_leased,
      (SELECT count(*) FROM oz_approval.decisions WHERE status='waiting_approval')::int waiting_approval,
      (SELECT count(*) FROM oz_approval.decisions WHERE status IN ('failed','publishing_unknown','preparing'))::int needs_attention,
      (SELECT count(*) FROM oz_approval.outbox WHERE state IN ('failed','unknown'))::int outbox_attention,
      (SELECT count(*) FROM oz_linkbio.items WHERE gallery_status='visible')::int visible_items,
      (SELECT last_synced_at FROM oz_approval.ingestion_state WHERE singleton=true) last_synced_at,
      (SELECT last_error FROM oz_approval.ingestion_state WHERE singleton=true) ingestion_error`),
    db.query(`SELECT post_id,version_no,status,decision_action,updated_at
      FROM oz_approval.decisions WHERE status IN ('failed','publishing_unknown','preparing')
      ORDER BY updated_at DESC LIMIT 15`),
  ]);
  const s=summary.rows[0], o=ops.rows[0];
  const rate=s.page_views ? 100*s.clicks/s.page_views : 0;
  const maxDaily=Math.max(1,...daily.rows.map(x=>Math.max(x.page_views,x.clicks)));
  const dailyRows=daily.rows.map(x=>`<tr><td>${escapeHtml(new Date(x.d).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}))}</td><td>${fmt(x.page_views)}</td><td>${fmt(x.visitors)}</td><td>${fmt(x.clicks)}</td><td><span class="bar" style="--w:${Math.round(100*x.page_views/maxDaily)}%"></span></td></tr>`).join('');
  const linkRows=links.rows.map(x=>`<tr><td>${escapeHtml(x.link_kind)}</td><td>${fmt(x.clicks)}</td></tr>`).join('')||'<tr><td colspan="2">Belum ada klik</td></tr>';
  const articleRows=articles.rows.map(x=>`<tr><td><a href="${escapeHtml(safeUrl(x.article_url))}">${escapeHtml(x.article_title)}</a></td><td>${fmt(x.clicks)}</td><td>${fmt(x.unique_clickers)}</td></tr>`).join('')||'<tr><td colspan="3">Belum ada data artikel</td></tr>';
  const failureRows=failures.rows.map(x=>`<tr><td>${x.post_id}</td><td>v${x.version_no}</td><td><span class="bad">${escapeHtml(x.status)}</span></td><td>${escapeHtml(new Date(x.updated_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}))}</td></tr>`).join('')||'<tr><td colspan="4">Tidak ada kegagalan aktif</td></tr>';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Dashboard Privat OtomotifZone</title><link rel="stylesheet" href="/assets/dashboard.css?v=20260926-1"></head><body class="dash"><main><header><div><small>OTOMOTIFZONE</small><h1>Dashboard Statistik Privat</h1><p>30 hari terakhir · diperbarui saat halaman dibuka</p></div><a href="/">Buka Link-in-Bio</a></header><section class="cards"><article><b>${fmt(s.page_views)}</b><span>Page views</span></article><article><b>${fmt(s.visitors)}</b><span>Pengunjung unik</span></article><article><b>${fmt(s.clicks)}</b><span>Total klik</span></article><article><b>${pct(rate)}</b><span>Rasio klik</span></article></section><section class="ops"><h2>Status Sistem</h2><div class="opsgrid"><p><b>${fmt(o.queue_pending)}</b> antrean artikel</p><p><b>${fmt(o.queue_leased)}</b> sedang diproses</p><p><b>${fmt(o.waiting_approval)}</b> menunggu approval</p><p class="${Number(o.needs_attention)+Number(o.outbox_attention)?'warn':''}"><b>${fmt(Number(o.needs_attention)+Number(o.outbox_attention))}</b> perlu perhatian</p><p><b>${fmt(o.visible_items)}</b> kartu galeri aktif</p></div><p class="muted">Sinkronisasi terakhir: ${o.last_synced_at?escapeHtml(new Date(o.last_synced_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})):'belum berjalan'}${o.ingestion_error?` · <span class="bad">${escapeHtml(o.ingestion_error)}</span>`:''}</p></section><section><h2>Tren Harian</h2><div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Views</th><th>Unik</th><th>Klik</th><th>Grafik views</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section><div class="twocol"><section><h2>Klik per tautan</h2><table><thead><tr><th>Jenis</th><th>Klik</th></tr></thead><tbody>${linkRows}</tbody></table></section><section><h2>Artikel teratas</h2><div class="tablewrap"><table><thead><tr><th>Artikel</th><th>Klik</th><th>Unik</th></tr></thead><tbody>${articleRows}</tbody></table></div></section></div><section><h2>Perlu perhatian</h2><table><thead><tr><th>Post</th><th>Versi</th><th>Status</th><th>Diperbarui</th></tr></thead><tbody>${failureRows}</tbody></table></section><footer>Data privat OtomotifZone · jangan bagikan akses dashboard.</footer></main></body></html>`;
}

function send(res, status, contentType, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await db.query('SELECT 1');
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, service: 'oz-linkbio' }), { 'Cache-Control': 'no-store' });
    }
    if (req.method === 'GET' && url.pathname === '/assets/styles.css') {
      return send(res, 200, 'text/css; charset=utf-8', css, { 'Cache-Control': 'public, max-age=86400' });
    }
    if (req.method === 'GET' && url.pathname === '/assets/app.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', appJs, { 'Cache-Control': 'public, max-age=86400' });
    }
    if (req.method === 'GET' && url.pathname === '/assets/dashboard.css') {
      return send(res, 200, 'text/css; charset=utf-8', dashboardCss, { 'Cache-Control': 'public, max-age=86400' });
    }
    if (req.method === 'GET' && url.pathname === '/assets/logo.png') {
      return send(res, 200, 'image/png', logo, { 'Cache-Control': 'public, max-age=86400' });
    }
    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      return send(res, 200, 'text/plain; charset=utf-8', 'User-agent: *\nDisallow: /\n', { 'Cache-Control': 'public, max-age=3600' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
      const html = page(await visibleItems());
      if (req.method === 'HEAD') return send(res, 200, 'text/html; charset=utf-8', '', { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' });
      recordEvent(req, {
        eventType: 'page_view',
        utmSource: url.searchParams.get('utm_source'),
        utmMedium: url.searchParams.get('utm_medium'),
        utmCampaign: url.searchParams.get('utm_campaign'),
      }).catch(error => console.error('analytics page_view:', error.message));
      return send(res, 200, 'text/html; charset=utf-8', html, { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/dashboard') {
      if (!dashboardAuthorized(req)) return send(res, 401, 'text/plain; charset=utf-8', 'Login diperlukan', {'WWW-Authenticate':'Basic realm="Dashboard OtomotifZone", charset="UTF-8"','Cache-Control':'no-store'});
      const html=await dashboardPage();
      return send(res, 200, 'text/html; charset=utf-8', req.method==='HEAD'?'':html, {'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});
    }
    if (req.method === 'POST' && url.pathname === '/events') {
      const payload = await readSmallJson(req);
      const allowed = new Set(['article','website','youtube','instagram','bagibagi','saweria']);
      if (!allowed.has(payload.kind)) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ ok: false }));
      await recordEvent(req, {
        eventType: 'link_click',
        linkKind: payload.kind,
        wpPostId: payload.kind === 'article' ? Number(payload.postId) : null,
        designVersion: payload.kind === 'article' ? bounded(payload.designVersion, 160) : null,
        referrer: payload.referrer,
        utmSource: payload.utmSource,
        utmMedium: payload.utmMedium,
        utmCampaign: payload.utmCampaign,
      });
      return send(res, 204, 'text/plain; charset=utf-8', '', { 'Cache-Control': 'no-store' });
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Tidak ditemukan');
  } catch (error) {
    console.error(error);
    return send(res, 503, 'text/plain; charset=utf-8', 'Halaman sedang diperbarui. Silakan coba lagi.');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`oz-linkbio listening on ${port}`));

const shutdown = async () => {
  server.close();
  await db.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
