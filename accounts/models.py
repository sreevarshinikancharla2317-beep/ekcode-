from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Maker proposes, checker verifies, auditor reads. The username is the role key for demo accounts."""
    ROLES = [("maker", "Maker, data steward"), ("checker", "Checker, materials manager"), ("auditor", "Auditor, read-only")]
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=ROLES, default="maker")
    org = models.CharField(max_length=120, blank=True)
    mobile_last4 = models.CharField(max_length=4, blank=True)
    initials = models.CharField(max_length=3, blank=True)
    color = models.CharField(max_length=9, default="#FFB547")

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    @property
    def title(self):
        return dict(self.ROLES).get(self.role, self.role)

    def as_json(self):
        return {"uid": self.username, "name": self.display_name, "email": self.email, "role": self.role, "title": self.title,
                "org": self.org, "init": self.initials, "color": self.color}
