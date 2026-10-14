from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.LoginView.as_view()),
    path("otp/", views.OtpView.as_view()),
    path("otp/resend/", views.OtpResendView.as_view()),
    path("sso/", views.SsoView.as_view()),
    path("switch/", views.SwitchView.as_view()),
    path("logout/", views.LogoutView.as_view()),
]
