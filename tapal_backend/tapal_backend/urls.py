from django.contrib import admin
from django.urls import include, path, re_path
from django.conf import settings
from django.views.static import serve

from api.views import shopper_qr_redirect
from api.push_views import firebase_config, firebase_messaging_sw

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    path('auth/', include('djoser.urls')),
    path('auth/', include('djoser.urls.jwt')),
    path('shopper/<slug:slug>/', shopper_qr_redirect, name='shopper-qr-redirect'),
    path('firebase-config.json', firebase_config, name='firebase-config'),
    path('firebase-messaging-sw.js', firebase_messaging_sw, name='firebase-messaging-sw'),
]

if settings.DEBUG or settings.SERVE_MEDIA:
    # Photos, videos and QR images. Fine at this scale; move to nginx or S3 if traffic grows.
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
