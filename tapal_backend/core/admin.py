from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = (
        'username',
        'email',
        'first_name',
        'last_name',
        'user_type',
        'city',
        'is_active',
        'is_staff',
    )
    list_filter = ('user_type', 'city', 'is_active', 'is_staff', 'is_superuser')
    search_fields = ('username', 'email', 'first_name', 'last_name', 'phone')
    ordering = ('-created_at',)

    fieldsets = DjangoUserAdmin.fieldsets + (
        (
            'Role & profile',
            {
                'fields': ('user_type', 'city', 'phone', 'is_active_user'),
            },
        ),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        (
            'Role & profile',
            {
                'fields': ('user_type', 'city', 'phone'),
            },
        ),
    )
