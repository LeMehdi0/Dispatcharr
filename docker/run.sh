#!/bin/bash

# Valeurs par défaut si non définies
CELERY_WORKER_CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-4}"
UWSGI_PROCESSES="${UWSGI_PROCESSES:-4}"
UWSGI_GEVENT="${UWSGI_GEVENT:-400}"
DISPATCHARR_SKIP_IP_LOOKUP="${DISPATCHARR_SKIP_IP_LOOKUP:-false}"
DISPATCHARR_DISABLE_BEAT="${DISPATCHARR_DISABLE_BEAT:-false}"

echo "Launching Dispatcharr with:"
echo "- Celery concurrency: $CELERY_WORKER_CONCURRENCY"
echo "- uWSGI workers: $UWSGI_PROCESSES"
echo "- uWSGI gevent: $UWSGI_GEVENT"

# Modifier uwsgi.ini dynamiquement
sed -i "s/--concurrency=[0-9]\+/--concurrency=$CELERY_WORKER_CONCURRENCY/" /app/docker/uwsgi.ini
sed -i "s/^workers = .*/workers = $UWSGI_PROCESSES/" /app/docker/uwsgi.ini
sed -i "s/^gevent = .*/gevent = $UWSGI_GEVENT/" /app/docker/uwsgi.ini

# Désactiver beat si demandé
if [ "$DISPATCHARR_DISABLE_BEAT" = "true" ]; then
  echo "Disabling Celery Beat..."
  sed -i '/celery -A dispatcharr beat/d' /app/docker/uwsgi.ini
fi

# Lancer uWSGI
uwsgi --ini /app/docker/uwsgi.ini
