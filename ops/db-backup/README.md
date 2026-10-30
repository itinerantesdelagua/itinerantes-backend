# Backup diario de la base de datos

Servicio cron de Railway **`db-backup`** (proyecto del backend). Todos los días a las 09:00 UTC
(03:00 en Ciudad de México) hace `pg_dump` de Postgres y lo sube al bucket **`eia-backups`**,
carpeta `postgres/`. Guarda los últimos 30 días y, para siempre, la copia del día 1 de cada mes.

Variables del servicio: `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), `BACKUP_BUCKET`,
`BACKUP_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (credenciales del bucket
`eia-backups`: `railway bucket credentials --bucket eia-backups`), `RETENTION_DAYS` (opcional).

Desplegar cambios: `cd ops/db-backup && railway up --service db-backup`.
Correr una copia ahora: botón "Run now" del servicio en Railway (o `railway cron`).

## Restaurar

1. Descargar la copia: `aws s3 cp s3://<bucket>/postgres/eia-<fecha>.dump . --endpoint-url https://t3.storageapi.dev`
2. Restaurar en una base vacía (idealmente una nueva, para revisar antes de reemplazar):
   `pg_restore --no-owner --no-privileges --clean --if-exists -d "<DATABASE_URL>" eia-<fecha>.dump`

Además, Postgres tiene activada la recuperación a un punto en el tiempo (PITR) de Railway:
`railway postgres pitr restore --service Postgres --at <fecha ISO>` (crea un servicio nuevo).
