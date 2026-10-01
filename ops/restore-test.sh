#!/bin/sh
set -eu
backup=${1:-}
test -n "$backup" -a -f "$backup/n8n-full.dump" -a -f "$backup/renderer-archive.tgz"
cd "$backup"
sha256sum -c SHA256SUMS >/dev/null
tar -tzf renderer-archive.tgz >/dev/null
name="oz-restore-test-$(date +%s)"
password="restore-$(date +%s)-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker run -d --name "$name" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=restore postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec "$name" pg_isready -U postgres -d restore >/dev/null 2>&1 && break; sleep 1; done
docker exec "$name" pg_isready -U postgres -d restore >/dev/null
docker cp n8n-full.dump "$name:/tmp/restore.dump"
docker exec "$name" pg_restore -U postgres -d restore --no-owner --no-acl /tmp/restore.dump
docker exec "$name" psql -U postgres -d restore -v ON_ERROR_STOP=1 -Atc \
  "select 'workflows='||count(*) from workflow_entity;
   select 'decisions='||count(*) from oz_approval.decisions;
   select 'ingestion='||count(*) from oz_approval.ingestion_articles;
   select 'linkbio_items='||count(*) from oz_linkbio.items;"
echo RESTORE_TEST_OK
