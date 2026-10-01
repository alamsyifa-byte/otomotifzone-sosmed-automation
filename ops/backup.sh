#!/bin/sh
set -eu
base=/home/JEF4090/n8n
stamp=$(date +%Y%m%d-%H%M%S)
dest="$base/backups/automatic-$stamp"
umask 077
mkdir -p "$dest/workflows"
docker exec n8n-postgres-1 pg_dump -U n8n -d n8n -Fc > "$dest/n8n-full.dump"
for id in OZApprovalStageV1 OZCallbackStageV1 OZFactVerifierTestV1; do
  docker exec n8n-n8n-1 n8n export:workflow --id="$id" --output="/tmp/backup-$id.json" >/dev/null
  docker cp "n8n-n8n-1:/tmp/backup-$id.json" "$dest/workflows/$id.json" >/dev/null
done
tar --exclude='renderer/media' --exclude='renderer/archive' -C "$base" -czf "$dest/configuration.tgz" \
  compose.yaml Caddyfile .env approval-service/.env linkbio-service/.env \
  approval-service renderer linkbio-service ops
docker run --rm -v "$base/renderer:/source:ro" -v "$dest:/backup" caddy:2-alpine \
  tar -C /source -czf /backup/renderer-archive.tgz media archive
sha256sum "$dest"/*.dump "$dest"/*.tgz > "$dest/SHA256SUMS"
find "$base/backups" -maxdepth 1 -type d -name 'automatic-*' -mtime +14 -exec rm -rf {} +
printf '%s\n' "$dest"
