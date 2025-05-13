#!/bin/bash

# Valeurs dynamiques via les variables d'env
CELERY_WORKER_CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-2}"
UWSGI_PROCESSES="${UWSGI_PROCESSES:-2}"
UWSGI_GEVENT="${UWSGI_GEVENT:-50}"
DISPATCHARR_DISABLE_BEAT="${DISPATCHARR_DISABLE_BEAT:-false}"

# Fichiers uwsgi à modifier
UWSGI_FILES=(
  "/app/docker/uwsgi.ini"
  "/app/docker/uwsgi.dev.ini"
  "/app/docker/uwsgi.debug.ini"
)

for file in "${UWSGI_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ Patching $file"
    sed -i "s/--concurrency=[0-9]\+/--concurrency=$CELERY_WORKER_CONCURRENCY/" "$file"
    sed -i "s/^workers = .*/workers = $UWSGI_PROCESSES/" "$file"
    sed -i "s/^gevent = .*/gevent = $UWSGI_GEVENT/" "$file"

    if [ "$DISPATCHARR_DISABLE_BEAT" = "true" ]; then
      echo "⛔ Removing Celery Beat from $file"
      sed -i '/celery -A dispatcharr beat/d' "$file"
    fi

    echo "🚀 Result in $file:"
    grep -E "(--concurrency=|^workers|^gevent)" "$file"
  else
    echo "⚠️  $file not found, skipping"
  fi
done

# Enfin, lancer l'entrypoint réel
exec /app/docker/entrypoint.sh
