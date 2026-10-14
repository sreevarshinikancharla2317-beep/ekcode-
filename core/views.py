from django.db import connection
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie


@ensure_csrf_cookie
def index(request):
    return render(request, "index.html")


def healthz(request):
    with connection.cursor() as c:
        c.execute("SELECT 1")
    return JsonResponse({"ok": True})
