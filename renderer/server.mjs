import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetRoot = path.join(here, 'design-assets');
const mediaRoot = process.env.MEDIA_ROOT || path.join(here, 'media');
const archiveRoot = process.env.ARCHIVE_ROOT || path.join(here, 'archive');
const publicMediaBase = String(process.env.PUBLIC_MEDIA_BASE || '').replace(/\/$/, '');
const map = JSON.parse(await readFile(path.join(here, 'asset-map.json'), 'utf8'));
const port = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024 * 1024;
const MAX_TEXT = 12_000;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let busy = false;

await mkdir(mediaRoot, { recursive: true });
await mkdir(archiveRoot, { recursive: true });

async function archiveRender(input, result, variant) {
  const postId = /^\d+$/.test(String(input.fields.post_id || '')) ? String(input.fields.post_id) : 'unknown';
  const sourceDir = path.join(archiveRoot, 'source', postId);
  const designDir = path.join(archiveRoot, 'design', postId);
  await Promise.all([mkdir(sourceDir, { recursive: true }), mkdir(designDir, { recursive: true })]);
  const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[input.photo.contentType] || 'bin';
  const sourceHash = createHash('sha256').update(input.photo.buffer).digest('hex');
  await writeFile(path.join(sourceDir, `${sourceHash}.${ext}`), input.photo.buffer, { flag: 'wx', mode: 0o600 }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(designDir, `${stamp}-${variant}-${randomUUID()}.jpg`), result.jpeg, { flag: 'wx', mode: 0o600 });
}

const prototypeAsset = (name) => path.join(assetRoot, 'oz-template-prototype', 'assets', name);
const fileData = async (fullPath, mime) => `data:${mime};base64,${(await readFile(fullPath)).toString('base64')}`;
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const normalizeName = (value) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readRequest(req) {
  const type = req.headers['content-type'] || '';
  const boundary = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!type.toLowerCase().startsWith('multipart/form-data') || !boundary) {
    throw fail(415, 'MULTIPART_REQUIRED', 'Kirim data sebagai multipart/form-data.');
  }
  const marker = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw fail(413, 'REQUEST_TOO_LARGE', 'Ukuran foto/form melewati batas 16 MB.');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks, length);
  const fields = Object.create(null);
  let photo;
  let cursor = 0;
  while (true) {
    const markerAt = body.indexOf(marker, cursor);
    if (markerAt < 0) break;
    if (body.subarray(markerAt + marker.length, markerAt + marker.length + 2).toString() === '--') break;
    const headerStart = markerAt + marker.length + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) break;
    const headers = body.subarray(headerStart, headerEnd).toString('latin1');
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const fieldName = disposition.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const dataStart = headerEnd + 4;
    const nextMarker = body.indexOf(Buffer.concat([Buffer.from('\r\n'), marker]), dataStart);
    if (!fieldName || nextMarker < 0) break;
    const data = body.subarray(dataStart, nextMarker);
    if (filename !== undefined) {
      if (fieldName === 'photo') {
        const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || 'application/octet-stream';
        photo = { buffer: data, contentType };
      }
    } else {
      if (data.length > MAX_TEXT) throw fail(413, 'FIELD_TOO_LARGE', `Field ${fieldName} terlalu panjang.`);
      fields[fieldName] = data.toString('utf8');
    }
    cursor = nextMarker + 2;
  }
  if (!photo?.buffer?.length) throw fail(400, 'PHOTO_REQUIRED', 'Foto artikel tidak diterima pada field photo.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)) {
    throw fail(415, 'PHOTO_TYPE_UNSUPPORTED', 'Foto harus JPEG, PNG, atau WebP.');
  }
  return { fields, photo };
}

async function render({ fields, photo }, canvasHeight = 1440) {
  const headline = (fields.headline || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('id-ID');
  const subheadline = (fields.subheadline || '').trim().replace(/\s+/g, ' ');
  const words = headline ? headline.split(' ') : [];
  if (!headline || words.length > 12 || [...headline].length > 80) {
    throw fail(422, 'HEADLINE_RULES', 'Headline kosong atau melebihi 12 kata/80 karakter.');
  }
  if (!subheadline || subheadline.split(' ').length > 20) {
    throw fail(422, 'SUBHEADLINE_RULES', 'Subheadline kosong atau melebihi 20 kata.');
  }
  if (/^(?:image\/jpeg|image\/png|image\/webp)$/.test(photo.contentType) === false) {
    throw fail(415, 'PHOTO_TYPE_UNSUPPORTED', 'Format foto tidak didukung.');
  }

  const sourceCategory = (fields.category || '').trim();
  const categoryEntry = map.category_assets.find((entry) => entry.name === sourceCategory);
  const visibleCategory = categoryEntry?.rendered_category || 'News';
  const renderedCategory = map.category_assets.find((entry) => entry.name === visibleCategory) || map.category_assets.find((entry) => entry.name === 'News');
  const categoryPng = renderedCategory?.asset;
  if (!categoryPng) throw fail(500, 'CATEGORY_ASSET_MISSING', 'Badge kategori News belum tersedia.');

  const author = (fields.author || '').trim().replace(/\s+/g, ' ');
  const authorAsset = author
    ? map.author_assets.find((entry) => normalizeName(entry.name) === normalizeName(author))?.asset
    : null;
  const authorImg = authorAsset ? await fileData(path.join(here, authorAsset), 'image/png') : '';

  const mime = photo.contentType;
  const photoImg = `data:${mime};base64,${photo.buffer.toString('base64')}`;
  const [logoTop, logoBottom, categoryImg, blackFont, mediumFont] = await Promise.all([
    fileData(prototypeAsset('logo-top.png'), 'image/png'),
    fileData(prototypeAsset('logo-bottom.png'), 'image/png'),
    fileData(path.join(here, categoryPng), 'image/png'),
    fileData(prototypeAsset('montserrat.black.otf'), 'font/otf'),
    fileData(prototypeAsset('montserrat.medium.otf'), 'font/otf'),
  ]);
  const focusX = Math.min(100, Math.max(0, Number(fields.focus_x ?? 50)));
  const focusY = Math.min(100, Math.max(0, Number(fields.focus_y ?? 50)));
  const page = await browser.newPage({ viewport: { width: 1080, height: canvasHeight }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face{font-family:OZBlack;src:url('${blackFont}') format('opentype');font-weight:900}
      @font-face{font-family:OZMedium;src:url('${mediumFont}') format('opentype');font-weight:500}
      *{box-sizing:border-box}html,body{margin:0;width:1080px;height:${canvasHeight}px;overflow:hidden}
      .poster{position:relative;width:1080px;height:${canvasHeight}px;overflow:hidden;background:#777;color:white}
      .photo{position:absolute;left:0;top:0;width:1080px;object-fit:cover;object-position:${focusX}% ${focusY}%}
      .logoTop{position:absolute;left:50px;top:72px;width:253px;height:35px;object-fit:contain}
      .category{position:absolute;right:0;top:61px;max-width:320px;max-height:70px;object-fit:contain;object-position:right top}
      .red{position:absolute;left:0;right:0;bottom:0;background:#d80101;text-align:center;color:#fff}
      .headline{position:absolute;left:48px;right:48px;text-align:right;font-family:OZBlack,sans-serif;font-weight:900;text-transform:uppercase}
      .subheadline{position:absolute;left:50px;right:48px;bottom:156px;text-align:right;font-family:OZMedium,sans-serif;font-weight:500;line-height:1.18}
      .logoBottom{position:absolute;left:50px;bottom:40px;width:72px;height:83px;object-fit:contain}
      .author{position:absolute;right:48px;bottom:60px;max-width:320px;max-height:60px;object-fit:contain;object-position:right bottom}
      #measure{position:absolute;left:-20000px;top:0;visibility:hidden}
    </style></head><body><article class="poster">
      <img class="photo" id="photo" src="${photoImg}"><img class="logoTop" src="${logoTop}"><img class="category" src="${categoryImg}">
      <section class="red" id="red"><div class="headline" id="headline"></div><div class="subheadline" id="subheadline"></div><img class="logoBottom" src="${logoBottom}">${authorImg ? `<img class="author" src="${authorImg}">` : ''}</section><canvas id="measure"></canvas>
    </article></body></html>`, { waitUntil: 'load', timeout: 10000 });

    await page.evaluate(async () => {
      await Promise.all([document.fonts.load('900 90px OZBlack'), document.fonts.load('500 28px OZMedium')]);
      await document.fonts.ready;
    });

    const layout = await page.evaluate(({ headline, subheadline }) => {
      const canvas = document.querySelector('#measure');
      const ctx = canvas.getContext('2d');
      const wrap = (text, maxWidth, size, weight, family) => {
        ctx.font = `${weight} ${size}px ${family}`;
        const words = text.split(/\s+/).filter(Boolean), lines = [];
        let line = '';
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (ctx.measureText(next).width <= maxWidth) line = next;
          else {
            if (!line || ctx.measureText(word).width > maxWidth) return null;
            lines.push(line); line = word;
          }
        }
        if (line) lines.push(line);
        return lines.length <= 2 ? lines : null;
      };
      let h;
      const characterCount = [...headline].length;
      const maxHeadlineSize = characterCount <= 28 ? 90 : Math.max(44, Math.min(72, Math.round(112 - 1.05 * characterCount)));
      for (let size = maxHeadlineSize; size >= 44; size--) {
        const lines = wrap(headline, 984, size, 900, 'OZBlack');
        if (lines) { h = { size, lines }; break; }
      }
      let s;
      if (h) {
        for (let size = 28; size >= 24; size--) {
          const lines = wrap(subheadline, 982, size, 500, 'OZMedium');
          if (lines) { s = { size, lines }; break; }
        }
      }
      if (!h) return { error: 'Headline tidak muat dua baris dengan font minimum 44 px.' };
      if (!s) return { error: 'Subheadline tidak muat dua baris dengan font minimum 24 px.' };
      const lineHeight = Math.round(h.size * (1.25 + h.size / 600));
      const headlineBottom = Math.max(212, 230 - Math.max(0, h.size - 52));
      const topInset = 32 - Math.max(0, h.size - 52) * 0.4;
      const redHeight = Math.max(400, Math.ceil(headlineBottom + h.lines.length * lineHeight + topInset));
      if (redHeight > 500) return { error: 'Teks dan logo melebihi tinggi box desain 500 px.' };
      return { h, s, lineHeight, headlineBottom, redHeight };
    }, { headline, subheadline });
    if (layout.error) throw fail(422, 'TEXT_DOES_NOT_FIT', layout.error);

    await page.evaluate(({ h, s, lineHeight, headlineBottom, redHeight, canvasHeight }) => {
      const red = document.querySelector('#red');
      red.style.height = `${redHeight}px`;
      const hEl = document.querySelector('#headline');
      hEl.style.fontSize = `${h.size}px`;
      hEl.style.lineHeight = `${lineHeight}px`;
      hEl.style.bottom = `${headlineBottom}px`;
      hEl.innerHTML = h.lines.map((line) => line.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))).join('<br>');
      const sEl = document.querySelector('#subheadline');
      sEl.style.fontSize = `${s.size}px`;
      sEl.innerHTML = s.lines.map((line) => line.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))).join('<br>');
      document.querySelector('#photo').style.height = `${canvasHeight - redHeight}px`;
    }, { ...layout, canvasHeight });
    const photoMeta = await page.locator('#photo').evaluate((el) => ({ ok: el.complete && el.naturalWidth > 0, width: el.naturalWidth, height: el.naturalHeight }));
    if (!photoMeta.ok || photoMeta.width * photoMeta.height > 50_000_000) throw fail(422, 'PHOTO_INVALID', 'Foto tidak dapat dibaca atau ukurannya melewati 50 megapiksel.');
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 92, fullPage: false, timeout: 10000 });
    return { jpeg, visibleCategory, sourceCategory, authorBadge: Boolean(authorImg), postId: fields.post_id || '', canvasHeight };
  } finally {
    await page.close();
  }
}

async function serveMedia(req, res) {
  const match = /^\/oz-media\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jpg$/i.exec(req.url || '');
  if (!match) return false;
  try {
    const jpeg = await readFile(path.join(mediaRoot, `${match[1]}.jpg`));
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': jpeg.length,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : jpeg);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: 'MEDIA_NOT_FOUND' }));
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  if (['GET', 'HEAD'].includes(req.method || '') && await serveMedia(req, res)) return;
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, renderer: 'oz-design-v1', canvas: '1080x1440', instagram_export: '1080x1350' }));
    return;
  }
  if (req.method !== 'POST' || !['/render', '/render-instagram'].includes(req.url || '')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
    return;
  }
  if (busy) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' });
    res.end(JSON.stringify({ success: false, error: 'RENDER_BUSY', message: 'Renderer sedang membuat gambar lain.' }));
    return;
  }
  busy = true;
  try {
    const input = await readRequest(req);
    const instagramExport = req.url === '/render-instagram';
    const result = await render(input, instagramExport ? 1350 : 1440);
    await archiveRender(input, result, instagramExport ? 'instagram-1080x1350' : 'master-1080x1440');
    if (instagramExport) {
      if (!publicMediaBase) throw fail(500, 'PUBLIC_MEDIA_BASE_MISSING', 'Alamat publik media Instagram belum dikonfigurasi.');
      if (result.jpeg.length > 8 * 1024 * 1024) throw fail(422, 'INSTAGRAM_FILE_TOO_LARGE', 'Ekspor Instagram melebihi 8 MB.');
      const mediaId = randomUUID();
      await writeFile(path.join(mediaRoot, `${mediaId}.jpg`), result.jpeg, { flag: 'wx', mode: 0o600 });
      return respondJson(res, 200, {
        success: true,
        media_id: mediaId,
        image_url: `${publicMediaBase}/${mediaId}.jpg`,
        width: 1080,
        height: 1350,
        content_type: 'image/jpeg',
        size_bytes: result.jpeg.length,
      });
    }
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': result.jpeg.length,
      'cache-control': 'no-store',
      'x-oz-renderer': 'oz-design-v1',
      'x-oz-canvas': '1080x1440',
      'x-oz-category': encodeURIComponent(result.visibleCategory),
      'x-oz-source-category': encodeURIComponent(result.sourceCategory),
      'x-oz-author-badge': result.authorBadge ? 'matched' : 'blank',
      ...(result.postId ? { 'x-oz-post-id': result.postId } : {}),
    });
    res.end(result.jpeg);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Render failed:', error.message);
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: error.code || 'RENDER_FAILED', message: error.message || 'Gagal membuat gambar.' }));
  } finally {
    busy = false;
  }
});

function respondJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.maxHeadersCount = 40;
server.listen(port, '0.0.0.0', () => console.log(`OZ renderer listening on ${port}`));
process.on('SIGTERM', async () => { server.close(); await browser.close(); process.exit(0); });
process.on('SIGINT', async () => { server.close(); await browser.close(); process.exit(0); });
