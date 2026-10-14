from django.core.management.base import BaseCommand

from core import services


class Command(BaseCommand):
    help = "Load the four companies' sample material masters, the demo accounts, and run the engine."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Reload the sample data and reset demo passwords")

    def handle(self, *args, reset=False, **kw):
        services.seed(force=reset)
        st = services.engine_state()
        from core.models import Material, Record
        self.stdout.write(self.style.SUCCESS(
            f"EkCode ready: {Record.objects.count()} records, {Material.objects.count()} materials, "
            f"precision {st.acc.get('precision', 0) * 100:.1f}%, recall {st.acc.get('recall', 0) * 100:.1f}%. "
            f"Demo password: {services.DEMO_PASSWORD}"))
