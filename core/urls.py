from django.urls import path

from . import api

urlpatterns = [
    path("state/", api.StateView.as_view()),
    path("run/", api.RunView.as_view()),
    path("materials/bulk-approve/", api.BulkApprove.as_view()),
    path("materials/<str:cid>/<str:action>/", api.MaterialAction.as_view()),
    path("records/<str:rid>/split/", api.SplitView.as_view()),
    path("records/<str:rid>/attach/", api.AttachView.as_view()),
    path("lookalikes/confirm/", api.ConfirmLookalike.as_view()),
    path("check/", api.CheckView.as_view()),
    path("check/reuse/", api.ReuseView.as_view()),
    path("requests/", api.RequestCreate.as_view()),
    path("requests/<str:rid>/<str:action>/", api.RequestAction.as_view()),
    path("uploads/", api.UploadView.as_view()),
    path("reset/", api.ResetView.as_view()),
    path("audit/verify/", api.AuditVerify.as_view()),
    path("export/<str:kind>/", api.Export.as_view()),
    path("export/<str:kind>/<str:arg>/", api.Export.as_view()),
]
