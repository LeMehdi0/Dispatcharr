# yourapp/tasks.py
from celery import shared_task
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import redis
import json
import logging
import re
import time
import os
from core.utils import RedisClient
from apps.proxy.ts_proxy.channel_status import ChannelStatus
from apps.m3u.models import M3UAccount
from apps.epg.models import EPGSource
from apps.m3u.tasks import refresh_single_m3u_account
from apps.epg.tasks import refresh_epg_data
from .models import CoreSettings
from apps.channels.models import Stream, ChannelStream
from django.db import transaction

logger = logging.getLogger(__name__)

EPG_WATCH_DIR = '/data/epgs'
M3U_WATCH_DIR = '/data/m3us'
MIN_AGE_SECONDS = 6
STARTUP_SKIP_AGE = 30
REDIS_PREFIX = "processed_file:"
REDIS_TTL = 60 * 60 * 24 * 3  # expire keys after 3 days (optional)

# Store the last known value to compare with new data
last_known_data = {}
# Store when we last logged certain recurring messages
_last_log_times = {}
# Don't repeat similar log messages more often than this (in seconds)
LOG_THROTTLE_SECONDS = 300  # 5 minutes

@shared_task
def beat_periodic_task():
    fetch_channel_stats()
    scan_and_process_files()

def throttled_log(logger_method, message, key=None, *args, **kwargs):
    """Only log messages with the same key once per throttle period"""
    if key is None:
        # Use message as key if no explicit key provided
        key = message

    now = time.time()
    if key not in _last_log_times or (now - _last_log_times[key]) >= LOG_THROTTLE_SECONDS:
        logger_method(message, *args, **kwargs)
        _last_log_times[key] = now

@shared_task
def scan_and_process_files():
    redis_client = RedisClient.get_client()
    now = time.time()

    # Add debug logging for the auto-import setting
    auto_import_value = CoreSettings.get_auto_import_mapped_files()
    logger.debug(f"Auto-import mapped files setting value: '{auto_import_value}' (type: {type(auto_import_value).__name__})")

    # Check if directories exist
    dirs_exist = all(os.path.exists(d) for d in [M3U_WATCH_DIR, EPG_WATCH_DIR])
    if not dirs_exist:
        throttled_log(logger.warning, f"Watch directories missing: M3U ({os.path.exists(M3U_WATCH_DIR)}), EPG ({os.path.exists(EPG_WATCH_DIR)})", "watch_dirs_missing")

    # Process M3U files
    m3u_files = [f for f in os.listdir(M3U_WATCH_DIR)
                if os.path.isfile(os.path.join(M3U_WATCH_DIR, f)) and
                (f.endswith('.m3u') or f.endswith('.m3u8'))]

    m3u_processed = 0
    m3u_skipped = 0

    for filename in m3u_files:
        filepath = os.path.join(M3U_WATCH_DIR, filename)
        mtime = os.path.getmtime(filepath)
        age = now - mtime
        redis_key = REDIS_PREFIX + filepath
        stored_mtime = redis_client.get(redis_key)

        # Instead of assuming old files were processed, check if they exist in the database
        if not stored_mtime and age > STARTUP_SKIP_AGE:
            # Check if this file is already in the database
            existing_m3u = M3UAccount.objects.filter(file_path=filepath).exists()
            if existing_m3u:
                logger.debug(f"Skipping {filename}: Already exists in database")
                redis_client.set(redis_key, mtime, ex=REDIS_TTL)
                m3u_skipped += 1
                continue
            else:
                logger.debug(f"Processing {filename} despite age: Not found in database")
                # Continue processing this file even though it's old

        # File too new — probably still being written
        if age < MIN_AGE_SECONDS:
            logger.debug(f"Skipping {filename}: Too new (age={age}s)")
            m3u_skipped += 1
            continue

        # Skip if we've already processed this mtime
        if stored_mtime and float(stored_mtime) >= mtime:
            logger.debug(f"Skipping {filename}: Already processed this version")
            m3u_skipped += 1
            continue

        m3u_account, created = M3UAccount.objects.get_or_create(file_path=filepath, defaults={
            "name": filename,
            "is_active": CoreSettings.get_auto_import_mapped_files() in [True, "true", "True"],
        })

        redis_client.set(redis_key, mtime, ex=REDIS_TTL)

        if not m3u_account.is_active:
            logger.debug(f"Skipping {filename}: M3U account is inactive")
            m3u_skipped += 1
            continue

        logger.info(f"Queueing refresh for M3U file: {filename}")
        refresh_single_m3u_account.delay(m3u_account.id)
        m3u_processed += 1

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            "updates",
            {
                "type": "update",
                "data": {"success": True, "type": "m3u_file", "filename": filename}
            },
        )

    logger.debug(f"M3U processing complete: {m3u_processed} processed, {m3u_skipped} skipped, {len(m3u_files)} total")

    # Process EPG files
    try:
        epg_files = os.listdir(EPG_WATCH_DIR)
        logger.debug(f"Found {len(epg_files)} files in EPG directory")
    except Exception as e:
        logger.error(f"Error listing EPG directory: {e}")
        epg_files = []

    epg_processed = 0
    epg_skipped = 0
    epg_errors = 0

    for filename in epg_files:
        filepath = os.path.join(EPG_WATCH_DIR, filename)

        if not os.path.isfile(filepath):
            logger.debug(f"Skipping {filename}: Not a file")
            epg_skipped += 1
            continue

        if not filename.endswith('.xml') and not filename.endswith('.gz'):
            logger.debug(f"Skipping {filename}: Not an XML or GZ file")
            epg_skipped += 1
            continue

        mtime = os.path.getmtime(filepath)
        age = now - mtime
        redis_key = REDIS_PREFIX + filepath
        stored_mtime = redis_client.get(redis_key)

        # Instead of assuming old files were processed, check if they exist in the database
        if not stored_mtime and age > STARTUP_SKIP_AGE:
            # Check if this file is already in the database
            existing_epg = EPGSource.objects.filter(file_path=filepath).exists()
            if existing_epg:
                logger.debug(f"Skipping {filename}: Already exists in database")
                redis_client.set(redis_key, mtime, ex=REDIS_TTL)
                epg_skipped += 1
                continue
            else:
                logger.debug(f"Processing {filename} despite age: Not found in database")
                # Continue processing this file even though it's old

        # File too new — probably still being written
        if age < MIN_AGE_SECONDS:
            logger.debug(f"Skipping {filename}: Too new, possibly still being written (age={age}s)")
            epg_skipped += 1
            continue

        # Skip if we've already processed this mtime
        if stored_mtime and float(stored_mtime) >= mtime:
            logger.debug(f"Skipping {filename}: Already processed this version")
            epg_skipped += 1
            continue

        try:
            epg_source, created = EPGSource.objects.get_or_create(file_path=filepath, defaults={
                "name": filename,
                "source_type": "xmltv",
                "is_active": CoreSettings.get_auto_import_mapped_files() in [True, "true", "True"],
            })

            # Add debug logging for created sources
            if created:
                logger.info(f"Created new EPG source '{filename}'")

            redis_client.set(redis_key, mtime, ex=REDIS_TTL)

            if not epg_source.is_active:
                logger.debug(f"Skipping {filename}: EPG source is marked as inactive")
                epg_skipped += 1
                continue

            logger.info(f"Queueing refresh for EPG file: {filename}")
            refresh_epg_data.delay(epg_source.id)  # Trigger Celery task
            epg_processed += 1

        except Exception as e:
            logger.error(f"Error processing EPG file {filename}: {str(e)}", exc_info=True)
            epg_errors += 1
            continue

    logger.debug(f"EPG processing complete: {epg_processed} processed, {epg_skipped} skipped, {epg_errors} errors")

def fetch_channel_stats():
    redis_client = RedisClient.get_client()

    try:
        # Basic info for all channels
        channel_pattern = "ts_proxy:channel:*:metadata"
        all_channels = []

        # Extract channel IDs from keys
        cursor = 0
        while True:
            cursor, keys = redis_client.scan(cursor, match=channel_pattern)
            for key in keys:
                channel_id_match = re.search(r"ts_proxy:channel:(.*):metadata", key.decode('utf-8'))
                if channel_id_match:
                    ch_id = channel_id_match.group(1)
                    channel_info = ChannelStatus.get_basic_channel_info(ch_id)
                    if channel_info:
                        all_channels.append(channel_info)

            if cursor == 0:
                break

    except Exception as e:
        logger.error(f"Error in channel_status: {e}", exc_info=True)
        return
        # return JsonResponse({'error': str(e)}, status=500)

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        "updates",
        {
            "type": "update",
            "data": {"success": True, "type": "channel_stats", "stats": json.dumps({'channels': all_channels, 'count': len(all_channels)})}
        },
    )

@shared_task
def rehash_streams(keys):
    batch_size = 1000
    queryset = Stream.objects.all()

    hash_keys = {}
    total_records = queryset.count()
    for start in range(0, total_records, batch_size):
        with transaction.atomic():
            batch = queryset[start:start + batch_size]
            for obj in batch:
                stream_hash = Stream.generate_hash_key(obj.name, obj.url, obj.tvg_id, keys)
                if stream_hash in hash_keys:
                    # Handle duplicate keys and remove any without channels
                    stream_channels = ChannelStream.objects.filter(stream_id=obj.id).count()
                    if stream_channels == 0:
                        obj.delete()
                        continue


                    existing_stream_channels = ChannelStream.objects.filter(stream_id=hash_keys[stream_hash]).count()
                    if existing_stream_channels == 0:
                        Stream.objects.filter(id=hash_keys[stream_hash]).delete()

                obj.stream_hash = stream_hash
                obj.save(update_fields=['stream_hash'])
                hash_keys[stream_hash] = obj.id

        logger.debug(f"Re-hashed {batch_size} streams")

    logger.debug(f"Re-hashing complete")
