# Generated by Django 5.1.6 on 2025-03-01 14:01

from django.db import migrations
from django.utils.text import slugify

def preload_core_settings(apps, schema_editor):
    CoreSettings = apps.get_model("core", "CoreSettings")
    CoreSettings.objects.create(
        key=slugify("M3U Hash Key"),
        name="M3U Hash Key",
        value="name,url,tvg_id",
    )

class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_rename_profile_name_streamprofile_name_and_more'),
    ]

    operations = [
        migrations.RunPython(preload_core_settings),
    ]
