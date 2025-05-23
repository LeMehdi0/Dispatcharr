# Generated by Django 5.1.6 on 2025-03-16 13:25

import uuid
from django.db import migrations, models


# Generated by Django 5.1.6 on 2025-03-16 13:25

import uuid
from django.db import migrations, models


def generate_uuids(apps, schema_editor):
    Channel = apps.get_model('dispatcharr_channels', 'Channel')
    for channel in Channel.objects.all():
        if not channel.uuid:
            channel.uuid = uuid.uuid4()
            channel.save()

class Migration(migrations.Migration):

    dependencies = [
        ('dispatcharr_channels', '0002_rename_channel_name_channel_name_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='channel',
            name='uuid',
            field=models.UUIDField(default=uuid.uuid4, editable=False),
        ),
        migrations.RunPython(generate_uuids),
        migrations.AlterField(
            model_name='channel',
            name='uuid',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
