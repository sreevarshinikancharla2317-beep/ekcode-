"""EkCode data model. Company material masters go in; the engine writes national materials back."""
from django.conf import settings
from django.db import models

USER = settings.AUTH_USER_MODEL


class Company(models.Model):
    code = models.CharField(max_length=3, primary_key=True)
    name = models.CharField(max_length=80)
    short = models.CharField(max_length=20)
    city = models.CharField(max_length=40)
    erp = models.CharField(max_length=40)
    color = models.CharField(max_length=9)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name


class Record(models.Model):
    """One legacy material master record, as it sits in a company's ERP."""
    SOURCES = [("seed", "Company extract"), ("upload", "Uploaded CSV"), ("request", "New-code request")]
    rid = models.CharField(max_length=8, primary_key=True)
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="records")
    code = models.CharField(max_length=40)
    desc = models.CharField(max_length=300)
    uom = models.CharField(max_length=12)
    price = models.FloatField(default=0)
    stock = models.FloatField(default=0)
    annual = models.FloatField(default=0)
    truth = models.IntegerField(null=True, blank=True, help_text="Answer key for the sample data only")
    internal = models.BooleanField(default=False)
    source = models.CharField(max_length=8, choices=SOURCES, default="seed")
    seq = models.PositiveIntegerField(db_index=True)
    # engine output
    cls = models.CharField(max_length=3, blank=True)
    attrs = models.JSONField(default=dict, blank=True)
    dq = models.PositiveSmallIntegerField(default=0)
    material = models.CharField(max_length=12, blank=True, db_index=True)

    class Meta:
        ordering = ["seq"]

    def __str__(self):
        return f"{self.company_id} {self.code}"


class Material(models.Model):
    """A national material: one cluster of records that describe the same part."""
    cid = models.CharField(max_length=12, primary_key=True)
    nmc = models.CharField(max_length=32, unique=True)
    cls = models.CharField(max_length=3, blank=True)
    type = models.CharField(max_length=14)
    score = models.PositiveSmallIntegerField(default=100)
    std = models.CharField(max_length=300)
    short = models.CharField(max_length=40)
    golden = models.JSONField(default=dict)
    alts = models.JSONField(default=list)
    brands = models.JSONField(default=list)
    flags = models.JSONField(default=list)
    notes = models.JSONField(default=list)
    hold = models.JSONField(null=True, blank=True)
    members = models.JSONField(default=list)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position"]

    def __str__(self):
        return f"{self.nmc} {self.std}"


class EngineState(models.Model):
    """Singleton (pk=1): whether harmonization has run, and the last run's statistics."""
    harmonized = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=0)
    compared = models.PositiveIntegerField(default=0)
    blocks = models.PositiveIntegerField(default=0)
    blocked = models.PositiveIntegerField(default=0)
    acc = models.JSONField(default=dict)
    lookalikes = models.JSONField(default=list)
    ms = models.FloatField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class Decision(models.Model):
    STATUS = [("proposed", "To approve"), ("approved", "Approved"), ("verified", "Verified")]
    cid = models.CharField(max_length=12, primary_key=True)
    status = models.CharField(max_length=10, choices=STATUS)
    approved_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)


class StdOverride(models.Model):
    cid = models.CharField(max_length=12, primary_key=True)
    text = models.CharField(max_length=300)
    by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    at = models.DateTimeField(auto_now=True)


class Split(models.Model):
    record = models.OneToOneField(Record, primary_key=True, on_delete=models.CASCADE)


class Link(models.Model):
    a = models.ForeignKey(Record, on_delete=models.CASCADE, related_name="+")
    b = models.ForeignKey(Record, on_delete=models.CASCADE, related_name="+")


class LookalikeConfirm(models.Model):
    key = models.CharField(max_length=20, unique=True)
    by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    at = models.DateTimeField(auto_now_add=True)


class CodeRequest(models.Model):
    STATUS = [("requested", "Open"), ("approved", "Approved"), ("rejected", "Rejected")]
    rid = models.CharField(max_length=10, primary_key=True)
    desc = models.CharField(max_length=300)
    company = models.ForeignKey(Company, on_delete=models.PROTECT)
    uom = models.CharField(max_length=6)
    by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    at = models.DateTimeField(auto_now_add=True)
    reason = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default="requested")
    reject_reason = models.CharField(max_length=300, blank=True)
    record = models.OneToOneField(Record, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["at"]


class Prevented(models.Model):
    """A duplicate stopped: someone reused an existing national code instead of creating one."""
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey(USER, null=True, on_delete=models.SET_NULL, related_name="+")
    nmc = models.CharField(max_length=32)
    desc = models.CharField(max_length=300)
    company = models.ForeignKey(Company, on_delete=models.PROTECT)


class AuditEntry(models.Model):
    """Tamper-evident log: each entry stores the hash of the one before it."""
    n = models.PositiveIntegerField(primary_key=True)
    t = models.BigIntegerField(help_text="Epoch milliseconds")
    actor = models.CharField(max_length=80)
    role = models.CharField(max_length=10)
    action = models.CharField(max_length=80)
    obj = models.CharField(max_length=120, blank=True)
    detail = models.TextField(blank=True)
    prev = models.CharField(max_length=64)
    hash = models.CharField(max_length=64)

    class Meta:
        ordering = ["n"]
        verbose_name_plural = "audit entries"


class LoginGuard(models.Model):
    email = models.CharField(max_length=254, primary_key=True)
    fails = models.PositiveSmallIntegerField(default=0)
    lock_until = models.DateTimeField(null=True, blank=True)
