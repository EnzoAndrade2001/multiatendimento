#!/usr/bin/env bash
set -Eeuo pipefail

backup_volume="${BACKUP_VOLUME:-multiatendimento_db_backups}"
backup_image="${BACKUP_IMAGE:-postgres:17}"
snapshot="${1:-latest}"
[[ "$snapshot" == latest || "$snapshot" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Use latest or YYYYMMDDTHHMMSSZ' >&2; exit 1; }
if [[ "$snapshot" == latest ]]; then
  # Resolve one completed pair, rather than reading two independently rotating links.
  latest_marker="$(docker run --rm -v "${backup_volume}:/db-backups:ro" "$backup_image" sh -eu -c \
    'find /db-backups -maxdepth 1 -name "multiatendimento-*.complete" -printf "%f\n" | sort | tail -n 1')"
  snapshot="${latest_marker#multiatendimento-}"
  snapshot="${snapshot%.complete}"
  [[ "$snapshot" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'No completed backup pair found' >&2; exit 1; }
fi
docker run --rm -v "${backup_volume}:/db-backups:ro" "$backup_image" test -f "/db-backups/multiatendimento-${snapshot}.complete"
dump_path="/db-backups/multiatendimento-${snapshot}.sql.gz"
media_path="/db-backups/multiatendimento-${snapshot}.uploads.tar.gz"
restore_container="multiatendimento-restore-drill-$(date -u +%Y%m%d%H%M%S)-$$"
cleanup() { docker rm -f "$restore_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Validate archives before starting a throwaway PostgreSQL instance. No production
# connection string, persistent data volume, network or published port is used.
docker run --rm -v "${backup_volume}:/db-backups:ro" "$backup_image" gzip -t "$dump_path"
docker run --rm -v "${backup_volume}:/db-backups:ro" "$backup_image" tar -tzf "$media_path" >/dev/null
docker run -d --name "$restore_container" --network none \
  --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_drill "$backup_image" >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$restore_container" pg_isready -U postgres -d restore_drill >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable PostgreSQL did not start' >&2; exit 1; }
docker run --rm -v "${backup_volume}:/db-backups:ro" "$backup_image" gzip -dc "$dump_path" \
  | docker exec -i "$restore_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d restore_drill >/dev/null
docker exec "$restore_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d restore_drill -c \
  'SELECT count(*) AS tenants FROM "Tenant"; SELECT count(*) AS messages FROM "Message"; SELECT count(*) AS schedules FROM "ScheduledMessage";'
echo "Restore drill passed for ${snapshot}: SQL restored and media archive validated. Disposable database will be removed."
