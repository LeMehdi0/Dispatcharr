#!/bin/bash

# Valeurs dynamiques
CELERY_WORKER_CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-4}"
UWSGI_PROCESSES="${UWSGI_PROCESSES:-4}"
UWSGI_GEVENT="${UWSGI_GEVENT:-400}"
DISPATCHARR_DISABLE_BEAT="${DISPATCHARR_DISABLE_BEAT:-false}"

UWSGI_FILE="/app/docker/uwsgi.ini"

echo "✅ Patching $UWSGI_FILE"
sed -i "s/--concurrency=[0-9]\+/--concurrency=$CELERY_WORKER_CONCURRENCY/" "$UWSGI_FILE"
sed -i "s/^workers = .*/workers = $UWSGI_PROCESSES/" "$UWSGI_FILE"
sed -i "s/^gevent = .*/gevent = $UWSGI_GEVENT/" "$UWSGI_FILE"

if [ "$DISPATCHARR_DISABLE_BEAT" = "true" ]; then
    echo "⛔ Removing Celery Beat from uwsgi.ini"
    sed -i '/celery -A dispatcharr beat/d' "$UWSGI_FILE"
fi

echo "🚀 Dispatcharr dynamic config applied:"
grep -E "(--concurrency=|^workers|^gevent)" "$UWSGI_FILE"

# Et maintenant on lance l'entrypoint original
exec /app/docker/entrypoint.sh
