#!/bin/sh
# Run on the VPS only after the required Telegram tests are accepted as complete.
set -eu

old_id=R9r2XqDrnFToJHV7
preview_id=OZApprovalStageV1
callback_id=OZCallbackStageV1
base=/home/JEF4090/n8n
stamp=$(date +%Y%m%d-%H%M%S)
backup="$base/backups/approval-switch-$stamp"
mkdir -p "$backup"

sql_status="select id, active, coalesce(\"activeVersionId\",'') from workflow_entity where id in ('$old_id','$preview_id','$callback_id') order by id"
docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "$sql_status" > "$backup/before-status.txt"
old_version=$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select \"activeVersionId\" from workflow_entity where id='$old_id' and active=true")
test -n "$old_version" || { echo 'Old workflow is not active; refusing switch.' >&2; exit 1; }
test "$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$preview_id'")" = f || { echo 'Preview workflow is already active.' >&2; exit 1; }
test "$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$callback_id'")" = t || { echo 'Callback workflow is not active.' >&2; exit 1; }
dedupe_state=$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select coalesce(node->>'disabled','false') from workflow_entity, jsonb_array_elements(nodes::jsonb) node where id='$preview_id' and node->>'name'='If row does not exist'")
test "$dedupe_state" = false || { echo 'Preview deduplication is missing or disabled.' >&2; exit 1; }
docker exec n8n-n8n-1 node -e "fetch('http://oz-approval:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker exec n8n-renderer-1 node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

for id in "$old_id" "$preview_id" "$callback_id"; do
  docker exec n8n-n8n-1 n8n export:workflow --id="$id" --output="/tmp/oz-$id-switch.json" >/dev/null
  docker cp "n8n-n8n-1:/tmp/oz-$id-switch.json" "$backup/$id.json"
done

rollback() {
  echo 'Switch failed; restoring the old published workflow.' >&2
  docker compose -f "$base/compose.yaml" restart n8n >/dev/null || true
  docker exec n8n-n8n-1 n8n unpublish:workflow --id="$preview_id" >/dev/null || true
  docker exec n8n-n8n-1 n8n publish:workflow --id="$old_id" --versionId="$old_version" >/dev/null || true
  docker compose -f "$base/compose.yaml" restart n8n >/dev/null || true
}
trap rollback EXIT HUP INT TERM

docker exec n8n-n8n-1 n8n unpublish:workflow --id="$old_id" >/dev/null
docker exec n8n-n8n-1 n8n publish:workflow --id="$preview_id" >/dev/null
docker compose -f "$base/compose.yaml" restart n8n >/dev/null

docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "$sql_status" > "$backup/after-status.txt"
test "$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$old_id'")" = f
test "$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$preview_id'")" = t
test "$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$callback_id'")" = t
docker exec n8n-n8n-1 node -e "fetch('http://oz-approval:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker exec n8n-renderer-1 node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

trap - EXIT HUP INT TERM
printf 'Approval switch complete. Backup: %s\n' "$backup"
