# Generated by Django 5.1.6 on 2025-04-27 12:56

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('m3u', '0008_m3uaccount_stale_stream_days'),
    ]

    operations = [
        migrations.AddField(
            model_name='m3uaccount',
            name='account_type',
            field=models.CharField(choices=[('STD', 'Standard'), ('XC', 'Xtream Codes')], default='STD'),
        ),
        migrations.AddField(
            model_name='m3uaccount',
            name='password',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='m3uaccount',
            name='username',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
    ]
