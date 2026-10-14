"""Sign-in: password, then a one-time code. Failed attempts lock the email for a short while."""
import hashlib
import secrets
import time
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import services as S
from core.models import LoginGuard

User = get_user_model()


def _h(code):
    return hashlib.sha256(f"ekcode-otp|{code}".encode()).hexdigest()


def _new_code(request, user, keep):
    code = f"{secrets.randbelow(900000) + 100000}"
    request.session["otp"] = {"uid": user.pk, "hash": _h(code), "exp": int(time.time() * 1000) + settings.EK_OTP_SECONDS * 1000, "tries": 0, "keep": bool(keep)}
    return {"ok": True, "mobile": user.mobile_last4, "demoCode": code if settings.EK_DEMO_OTP else None, "expiresIn": settings.EK_OTP_SECONDS}


def _signed_in(request, user, keep, method):
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    if not keep:
        request.session.set_expiry(0)
    S.audit(user, "Signed in", user.email, method)
    return Response({"ok": True, "state": S.build_state(user), "toast": f"Signed in as {user.display_name}, {user.title.lower()}."})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        pw = request.data.get("pw") or ""
        if not email or not pw:
            return Response({"error": "Enter your official email and password."}, status=400)
        guard, _ = LoginGuard.objects.get_or_create(email=email)
        now = timezone.now()
        if guard.lock_until and guard.lock_until > now:
            return Response({"error": "Too many attempts. Sign-in is locked for a short while.", "lockUntil": guard.lock_until.timestamp() * 1000}, status=423)
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user or not user.check_password(pw):
            guard.fails += 1
            if guard.fails >= settings.EK_LOCK_AFTER:
                guard.fails, guard.lock_until = 0, now + timedelta(seconds=settings.EK_LOCK_SECONDS)
                guard.save()
                return Response({"error": f"Too many attempts. Sign-in is locked for {settings.EK_LOCK_SECONDS} seconds.",
                                 "lockUntil": guard.lock_until.timestamp() * 1000}, status=423)
            guard.save()
            left = settings.EK_LOCK_AFTER - guard.fails
            return Response({"error": f"That email and password do not match. {left} attempt{'s' if left != 1 else ''} left before a {settings.EK_LOCK_SECONDS} second lock."}, status=400)
        guard.fails, guard.lock_until = 0, None
        guard.save()
        return Response(_new_code(request, user, request.data.get("keep", True)))


@method_decorator(csrf_protect, name="dispatch")
class OtpView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        p = request.session.get("otp")
        if not p:
            return Response({"error": "Start again with your email and password.", "restart": True}, status=400)
        code = "".join(ch for ch in str(request.data.get("code") or "") if ch.isdigit())
        if int(time.time() * 1000) > p["exp"]:
            return Response({"error": "That code has expired. Send a new code."}, status=400)
        if _h(code) != p["hash"]:
            p["tries"] += 1
            if p["tries"] >= 3:
                del request.session["otp"]
                return Response({"error": "Three wrong codes. Sign in again.", "restart": True}, status=400)
            request.session["otp"] = p
            left = 3 - p["tries"]
            return Response({"error": f"That code is not right. {left} tr{'y' if left == 1 else 'ies'} left."}, status=400)
        del request.session["otp"]
        user = User.objects.get(pk=p["uid"])
        return _signed_in(request, user, p["keep"], "Password and one-time code")


@method_decorator(csrf_protect, name="dispatch")
class OtpResendView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        p = request.session.get("otp")
        if not p:
            return Response({"error": "Start again with your email and password.", "restart": True}, status=400)
        return Response(_new_code(request, User.objects.get(pk=p["uid"]), p["keep"]))


@method_decorator(csrf_protect, name="dispatch")
class SsoView(APIView):
    """Simulated Jan Parichay single sign-on for the demo accounts. Replace with a real OIDC flow in production."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        user = User.objects.filter(username=request.data.get("uid", ""), is_active=True).first()
        if not user or user.username not in ("maker", "checker", "auditor"):
            return Response({"error": "Unknown account."}, status=400)
        return _signed_in(request, user, True, "Jan Parichay single sign-on (simulated)")


class SwitchView(APIView):
    """Demo shortcut: switch between the three demo accounts."""
    def post(self, request):
        target = User.objects.filter(username=request.data.get("uid", ""), is_active=True).first()
        if not target or target.username not in ("maker", "checker", "auditor") or target == request.user:
            return Response({"error": "Unknown account."}, status=400)
        S.audit(request.user, "Signed out", request.user.email, "Demo shortcut: switching account")
        return _signed_in(request, target, True, "Demo shortcut")


class LogoutView(APIView):
    def post(self, request):
        S.audit(request.user, "Signed out", request.user.email, "Session ended")
        logout(request)
        return Response({"ok": True, "state": S.build_state(None), "toast": "Signed out."})
