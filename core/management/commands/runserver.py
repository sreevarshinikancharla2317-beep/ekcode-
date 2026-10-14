"""runserver on port 8001 by default, so EkCode and KindBytes (port 8000) can run side by side."""
from django.contrib.staticfiles.management.commands.runserver import Command as StaticRunserver


class Command(StaticRunserver):
    default_port = "8001"
