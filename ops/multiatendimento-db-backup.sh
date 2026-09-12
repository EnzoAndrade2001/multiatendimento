#!/usr/bin/env bash

set -Eeuo pipefail

backup_volume="${BACKUP_VOLUME:-multiatendimento_db_backups}"
backup_image="${BACKUP_IMAGE:-postgres:17}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
uploads_path="${UPLOADS_PATH:-/srv/multiatendimento/uploads}"
[[ "$retention_days" =~ ^[0-9]+$ ]] && (( retention_days >= 1 )) || { echo 'Invalid retention days' >&2; exit 1; }
[[ -d "$uploads_path" ]] || { echo "Uploads directory unavailable: $uploads_path" >&2; exit 1; }
# A local lock prevents overlapping cron executions from publishing partial pairs.
exec 9>"${TMPDIR:-/tmp}/multiatendimento-db-backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
snapshot="multiatendimento-$(date -u +%Y%m%dT%H%M%SZ)"
temporary_path="/db-backups/.${snapshot}.sql.gz.tmp"
final_path="/db-backups/${snapshot}.sql.gz"
media_temporary="/db-backups/.${snapshot}.uploads.tar.gz.tmp"
media_final="/db-backups/${snapshot}.uploads.tar.gz"
cleanup() {
  docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" rm -f -- "$temporary_path" "$media_temporary" >/dev/null 2>&1 || true
}
trap cleanup EXIT

postgres_container="$(docker ps -q --filter name=multiatendimento_postgres.1 | head -n 1)"
if [[ -z "${postgres_container}" ]]; then
  echo "PostgreSQL container not found" >&2
  exit 1
fi

docker exec "${postgres_container}" pg_dump \
  -U postgres \
  -d multiatendimento_db \
  --no-owner \
  --no-privileges \
  | gzip -c \
  | docker run --rm -i -v "${backup_volume}:/db-backups" "${backup_image}" tee "${temporary_path}" >/dev/null

# pipefail above propagates failures from pg_dump, gzip and the volume writer.
docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" gzip -t "$temporary_path"
docker run --rm -v "${uploads_path}:/source-uploads:ro" -v "${backup_volume}:/db-backups" "${backup_image}" \
  tar -czf "$media_temporary" -C /source-uploads .
docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" tar -tzf "$media_temporary" >/dev/null

docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" sh -eu -c '
  mv "$1" "$2"
  mv "$3" "$4"
  touch "/db-backups/$5.complete"
  ln -f "$2" /db-backups/.latest-sql.tmp
  mv -f /db-backups/.latest-sql.tmp /db-backups/multiatendimento-latest.sql.gz
  ln -f "$4" /db-backups/.latest-uploads.tmp
  mv -f /db-backups/.latest-uploads.tmp /db-backups/multiatendimento-latest.uploads.tar.gz
' sh "$temporary_path" "$final_path" "$media_temporary" "$media_final" "$snapshot"

# Retention is constrained to this volume and this exact timestamped naming scheme.
docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" \
  find /db-backups -maxdepth 1 -regextype posix-extended -type f \
  -regex '/db-backups/multiatendimento-[0-9]{8}T[0-9]{6}Z\.(sql\.gz|uploads\.tar\.gz|complete)' \
  -mtime "+${retention_days}" -delete

backup_bytes="$(docker run --rm -v "${backup_volume}:/db-backups" "${backup_image}" stat -c %s "${final_path}")"
echo "Backup completed: ${snapshot} (${backup_bytes} SQL bytes), including uploads; retention ${retention_days} days"
