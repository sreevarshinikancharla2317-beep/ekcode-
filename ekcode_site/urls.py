from django.contrib import admin
from django.urls import include, path

from core import views

urlpatterns = [
    path("", views.index, name="index"),
    path("healthz", views.healthz),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("core.urls")),
]
