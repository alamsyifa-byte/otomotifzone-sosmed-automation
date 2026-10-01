# Rancangan Telegram approval dan notifikasi OtomotifZone

> Dokumen ini adalah rancangan awal. Untuk keadaan server yang sudah dipasang dan hasil uji terbaru, gunakan [`STATUS_TELEGRAM_APPROVAL_2026-09-25.md`](STATUS_TELEGRAM_APPROVAL_2026-09-25.md). Pernyataan di bawah tentang Chat ID yang belum tersedia sudah tidak berlaku.

Status dokumen ini: rancangan implementasi. Belum ada grup approval/channel notifikasi yang terhubung, dan workflow produksi belum dimodifikasi atau diaktifkan ulang.

## Fakta dari server dan handoff

- Workflow produksi: `R9r2XqDrnFToJHV7` (`OtomotifZone - Web to Telegram - Resume v1`).
- Workflow aktif memiliki satu credential Telegram n8n bernama `Telegram account`; token tidak disimpan di workflow export.
- Alur saat ini mengirim foto langsung ke sebuah chat Telegram dengan ID numerik yang sudah ada di node `Send a photo message`, lalu menulis `post_id` ke Data Table `processed_articles`.
- Tabel itu hanya memiliki kolom `post_id`. Ia adalah deduplikasi artikel dan harus tetap utuh; ia tidak menyimpan versi desain, keputusan, atau audit.
- Catatan sebelumnya menunjukkan HTML preview desain berhasil, tetapi alur produksi penuh setelah perubahan desain belum diuji ulang sampai Telegram.
- n8n 2.40.6 dan node Telegram Trigger tersedia. Trigger mendukung `callback_query`; node Telegram mendukung inline keyboard, `answerCallbackQuery`, dan pengeditan pesan.
- Permintaan pengguna menyebut grup approval privat dan channel notifikasi, tetapi belum memberi tahu bahwa keduanya sudah dibuat atau memberi Chat ID masing-masing.

## Keputusan rancangan

1. Buat tabel keputusan baru `oz_approval_decisions`; jangan mengubah tabel `processed_articles`.
2. Setiap versi desain mendapat UUID `design_version`. Kunci unik `(post_id, design_version)` memastikan hanya satu keputusan awal per versi. Simpan action/status dalam baris tersebut. Gunakan `INSERT ... ON CONFLICT DO NOTHING` untuk pembuatan versi baru dan satu `UPDATE ... WHERE status='waiting_approval' RETURNING ...` untuk klaim keputusan. Hanya callback yang menerima baris dari `RETURNING` boleh melanjutkan. Status dibaca/diubah dalam statement database atomik yang sama; jangan memisahkan pemeriksaan dan update.
3. Gunakan PostgreSQL node bawaan n8n dengan credential database baru yang memakai akses terbatas pada tabel approval, atau layanan internal kecil yang mengakses database. Jangan meminjam tabel internal n8n secara langsung atau memakai Data Table lama sebagai mutex. Jangan menaruh password database di workflow.
4. Pisahkan workflow penerbit desain dari workflow callback. Callback Telegram masuk lewat Telegram Trigger terpisah, diverifikasi dengan `callback_query.message.chat.id == APPROVAL_GROUP_CHAT_ID`, memastikan pesan berasal dari bot dan pasangan `message_id/design_version/post_id` cocok, lalu melakukan klaim atomik. Tidak ada allowlist user ID; semua anggota grup yang pesan callback-nya valid bisa bertindak. Identitas pengguna tetap masuk audit.
5. Gunakan callback data ringkas dan tidak sensitif, misalnya `oz:<design_version>:approve`, `revise`, `rerender`, `skip`; validasi panjang Telegram 64 byte. UUID penuh + kata kerja berada di bawah batas.
6. Klaim keputusan dan audit harus tersimpan sebelum edit tombol atau menjalankan side effect. Retry setelah claim membaca status dan tidak mengirim pesan kedua. Untuk efek publikasi, gunakan outbox/idempotency: catat tugas channel di database dalam transaksi klaim yang sama; worker mengirim lalu mencatat `channel_message_id`. Karena Telegram sendPhoto tidak memberi idempotency key, crash tepat setelah Telegram menerima pesan tetapi sebelum message ID tersimpan tidak bisa dijamin exactly-once hanya dengan retry. Untuk jaminan “tidak pernah dua kali”, worker tidak boleh mengirim ulang status `sending` secara otomatis; tandai `publishing_unknown` untuk rekonsiliasi manual. Itu mengutamakan tanpa-duplikasi daripada auto-recovery.
7. Sesudah klaim, edit pesan grup untuk menghapus keyboard dan menampilkan identitas/waktu/status. `answerCallbackQuery` selalu membalas cepat; callback kalah menerima nama/waktu pemenang dari baris keputusan.
8. `revision_requested` dan `rendering` memerlukan proses versi lanjutan. Versi baru menambah `design_version`, kembali ke `waiting_approval`, dan mengirim pesan approval baru; versi lama tetap terkunci. `skipped` tidak membuat side effect channel.
9. Status produksi yang direkomendasikan: `waiting_approval`, `approved`, `revision_requested`, `rendering`, `skipped`, `publishing`, `published`, `failed`, plus `publishing_unknown` untuk hasil API Telegram yang tidak pasti.
10. Jangan daftarkan webhook kedua ke bot yang sama secara bersamaan. Telegram hanya memberi satu webhook aktif per bot. Matikan alur bot lain hanya setelah memetakan registrasi saat ini dan menyiapkan perpindahan terkontrol.

## Skema tabel usulan

```sql
CREATE TABLE oz_approval_decisions (
  post_id BIGINT NOT NULL,
  design_version UUID NOT NULL,
  decision_status TEXT NOT NULL,
  decision_action TEXT,
  decided_by_user_id BIGINT,
  decided_by_name TEXT,
  decided_by_username TEXT,
  decided_at TIMESTAMPTZ,
  approval_group_chat_id BIGINT NOT NULL,
  approval_message_id BIGINT,
  notification_channel_chat_id BIGINT NOT NULL,
  channel_message_id BIGINT,
  preview_binary_ref TEXT,
  caption TEXT,
  article_url TEXT NOT NULL,
  content_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, design_version)
);

CREATE TABLE oz_approval_outbox (
  post_id BIGINT NOT NULL,
  design_version UUID NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, design_version, action),
  FOREIGN KEY (post_id, design_version)
    REFERENCES oz_approval_decisions(post_id, design_version)
);
```

Approval claim must be one conditional SQL operation, parameterized (never interpolate callback strings):

```sql
UPDATE oz_approval_decisions
SET decision_status = $3,
    decision_action = $4,
    decided_by_user_id = $5,
    decided_by_name = $6,
    decided_by_username = $7,
    decided_at = now(),
    updated_at = now()
WHERE post_id = $1
  AND design_version = $2
  AND decision_status = 'waiting_approval'
RETURNING *;
```

For `approve`, transactionally create the unique outbox row in the same database transaction. A zero-row result means the callback lost, is stale, or was already handled; read the winner only to build the callback response. A single n8n Postgres node execution should include the transaction/CTE so the claim and outbox insert are not separate operations.

## Callback validation

- Require `callback_query`, `callback_query.message`, `callback_query.from`, and callback data matching the expected version/action syntax.
- Require message `chat.id` exactly equals the configured approval group ID.
- Require `message.from.is_bot == true` and validate that `message.from.id` matches the bot identity used by the credential when available.
- Require group message ID and design version to match the stored approval row.
- Do not check or maintain an approver user allowlist. Record user ID, first/last name, username, and timestamp on the winning action.
- For a rejected/stale callback, answer without changing the decision. Do not create an outbox event.

## Telegram message content

Approval photo caption: concise metadata plus headline, subheadline, full Instagram caption, author, category, source link, and any validation warnings. Attach four inline buttons: Approve, Revisi, Render Ulang, Lewati.

Notification channel photo caption: final caption plus original article link only. No approval controls or draft content.

## Pengujian sebelum produksi

Build a separate test workflow and test table; do not execute test decisions against the production dedupe table. Verify SQL concurrency by racing many claims for one `(post_id, design_version)` and assert exactly one returned row/outbox event. Then test all four actions, duplicate callback, duplicate click, other-member opposing click, invalid chat, non-bot message, stale design version, retry, message edit, and channel gate. Use a test Telegram group/channel created by the user, then remove test content. Production stays inactive until every listed test has evidence and the user explicitly asks to activate.

## Inputs needed before wiring Telegram destinations

- `APPROVAL_GROUP_CHAT_ID` for the private group.
- `NOTIFICATION_CHANNEL_CHAT_ID` for the channel.
- Confirmation that the existing `Telegram account` bot was added to the group and is channel admin with send-photo/send-message permissions.
- A restricted Postgres credential for the approval schema/table, or user choice to use a small internal service. Never send the password in chat; enter it directly in n8n Credentials.
- Clarification whether the prior direct-to-chat Telegram notification should be removed from the production path when approval is eventually enabled. Recommended: yes, after a supervised test, to avoid duplicate destinations.
