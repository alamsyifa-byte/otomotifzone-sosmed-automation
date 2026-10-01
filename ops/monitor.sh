#!/bin/sh
set -u
base=/home/JEF4090/n8n
log="$base/ops/monitor-history.log"
now=$(date -Iseconds)
fail=0
check_http(){ code=$(curl -ksS --max-time 8 -o /dev/null -w '%{http_code}' "$2" || true); [ "$code" = 200 ] || fail=1; printf '%s=%s ' "$1" "$code"; }
{
  printf '%s ' "$now"
  check_http n8n https://139-190-98-210.sslip.io/healthz
  check_http linkbio https://link.139-190-98-210.sslip.io/healthz
  for c in n8n-postgres-1 n8n-n8n-1 n8n-renderer-1 n8n-approval-1 n8n-linkbio-1 n8n-caddy-1; do
    state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
    [ "$state" = running ] || fail=1
    printf '%s=%s ' "$c" "$state"
  done
  metrics=$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select
    (select count(*) from oz_approval.ingestion_articles where state='pending')||','||
    (select count(*) from oz_approval.decisions where status in ('failed','publishing_unknown') or (status='preparing' and updated_at<now()-interval '20 minutes'))||','||
    (select count(*) from oz_approval.outbox where state in ('failed','unknown'))" 2>/dev/null || echo db_error)
  [ "$metrics" != db_error ] || fail=1
  printf 'queue_attention_outbox=%s disk=' "$metrics"
  df -P / | awk 'NR==2{print $5}'
} >> "$log"
tail -n 1000 "$log" > "$log.tmp" && mv "$log.tmp" "$log"
exit "$fail"
