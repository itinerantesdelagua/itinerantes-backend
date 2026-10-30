#!/bin/sh
# Copia completa de la base (pg_dump formato custom) al bucket de backups.
# Retención: se borran las copias de más de RETENTION_DAYS días, salvo las del día 1 de cada mes.
set -eu

: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${BACKUP_BUCKET:?Falta BACKUP_BUCKET}"
: "${BACKUP_ENDPOINT:?Falta BACKUP_ENDPOINT}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/tmp/eia-$ts.dump"
key="postgres/eia-$ts.dump"
s3() { aws --endpoint-url "$BACKUP_ENDPOINT" "$@"; }

echo "[backup] pg_dump…"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file "$file"
echo "[backup] tamaño: $(du -h "$file" | cut -f1)"

s3 s3 cp "$file" "s3://$BACKUP_BUCKET/$key" --only-show-errors
rm -f "$file"
echo "[backup] subido: s3://$BACKUP_BUCKET/$key"

cutoff=$(date -u -d "@$(( $(date +%s) - RETENTION_DAYS * 86400 ))" +%Y-%m-%d)
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix postgres/ \
  --query 'Contents[].Key' --output text | tr '\t' '\n' | while read -r old; do
  [ -z "$old" ] || [ "$old" = "None" ] && continue
  day=$(echo "$old" | sed -E 's#postgres/eia-([0-9]{4}-[0-9]{2}-[0-9]{2}).*#\1#')
  case "$day" in *-01) continue ;; esac
  if [ "$day" \< "$cutoff" ]; then
    s3 s3 rm "s3://$BACKUP_BUCKET/$old" --only-show-errors && echo "[backup] borrado (viejo): $old"
  fi
done
echo "[backup] listo."
