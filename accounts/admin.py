from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class EkUserAdmin(UserAdmin):
    list_display = ("username", "email", "first_name", "role", "org", "is_staff")
    list_filter = ("role",)
    fieldsets = UserAdmin.fieldsets + (("EkCode", {"fields": ("role", "org", "mobile_last4", "initials", "color")}),)
