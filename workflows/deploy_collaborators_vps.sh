#!/bin/sh
# Run on the OtomotifZone VPS after the current exports and database dump are saved.
set -eu
base=/home/JEF4090/n8n
backup="$base/backups/collaborator-pre-20260926"
test -s "$backup/preview.json"
test -s "$backup/callback.json"
test -s "$backup/n8n-full.dump"
test -s "$backup/oz-preview-collab-deploy.json"
test -s "$backup/oz-callback-collab-deploy.json"

restore() {
  echo 'Deployment failed; restoring both workflow exports.' >&2
  docker cp "$backup/callback.json" n8n-n8n-1:/tmp/oz-callback-collab-rollback.json || true
  docker cp "$backup/preview.json" n8n-n8n-1:/tmp/oz-preview-collab-rollback.json || true
  docker exec n8n-n8n-1 n8n import:workflow --input=/tmp/oz-callback-collab-rollback.json >/dev/null || true
  docker exec n8n-n8n-1 n8n import:workflow --input=/tmp/oz-preview-collab-rollback.json >/dev/null || true
  docker exec n8n-n8n-1 n8n publish:workflow --id=OZCallbackStageV1 >/dev/null || true
  docker exec n8n-n8n-1 n8n publish:workflow --id=OZApprovalStageV1 >/dev/null || true
  docker compose -f "$base/compose.yaml" restart n8n >/dev/null || true
}
trap restore EXIT HUP INT TERM

docker exec n8n-n8n-1 n8n import:workflow --input=/tmp/oz-callback-collab-deploy.json >/dev/null
docker exec n8n-n8n-1 n8n publish:workflow --id=OZCallbackStageV1 >/dev/null
docker exec n8n-n8n-1 n8n import:workflow --input=/tmp/oz-preview-collab-deploy.json >/dev/null
docker exec n8n-n8n-1 n8n publish:workflow --id=OZApprovalStageV1 >/dev/null
docker compose -f "$base/compose.yaml" restart n8n >/dev/null

for id in OZApprovalStageV1 OZCallbackStageV1; do
  state=$(docker exec n8n-postgres-1 psql -U n8n -d n8n -Atc "select active from workflow_entity where id='$id'")
  test "$state" = t
done
docker exec n8n-n8n-1 node -e "fetch('http://oz-approval:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
trap - EXIT HUP INT TERM
echo 'Collaborator production workflows published.'
