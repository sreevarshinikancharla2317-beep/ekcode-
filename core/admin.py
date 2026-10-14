from django.contrib import admin

from .models import AuditEntry, CodeRequest, Company, Decision, EngineState, Material, Prevented, Record


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "city", "erp")


@admin.register(Record)
class RecordAdmin(admin.ModelAdmin):
    list_display = ("rid", "company", "code", "desc", "uom", "cls", "dq", "material", "source")
    list_filter = ("company", "cls", "source")
    search_fields = ("code", "desc", "material")


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ("nmc", "std", "cls", "type", "score")
    list_filter = ("cls", "type")
    search_fields = ("nmc", "std", "cid")


@admin.register(Decision)
class DecisionAdmin(admin.ModelAdmin):
    list_display = ("cid", "status", "approved_by", "verified_by", "verified_at")
    list_filter = ("status",)


@admin.register(CodeRequest)
class CodeRequestAdmin(admin.ModelAdmin):
    list_display = ("rid", "desc", "company", "status", "by", "at")
    list_filter = ("status",)


@admin.register(AuditEntry)
class AuditEntryAdmin(admin.ModelAdmin):
    list_display = ("n", "actor", "role", "action", "obj", "hash")
    list_filter = ("role", "action")

    def has_change_permission(self, request, obj=None):
        return False          # the audit trail is append-only

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(EngineState)
admin.site.register(Prevented)
