from django.contrib.auth.models import AbstractUser
from django.db import models


class UserType(models.IntegerChoices):
    HEAD_OFFICE = 1, 'Head Office'
    ADMIN = 2, 'Administrator'
    STORE_MANAGER = 3, 'Store Manager'
    BRAND_AMBASSADOR = 4, 'Brand Ambassador'


class HoRole(models.TextChoices):
    """Head Office sub-role. Only meaningful when user_type is Head Office."""

    STANDARD = 'standard', 'Standard'
    MIS = 'mis', 'MIS'


class AbstractCoreUser(AbstractUser):
    """
    Abstract base user for the Tapal Brand Ambassador ecosystem.

    user_type:
        1 — Head Office
        2 — Administrator
        3 — Store Manager
        4 — Brand Ambassador

    ho_role (Head Office only):
        standard — full Head Office UI
        mis — Head Office with some pages hidden (Dashboard, Stock)
    """

    email = models.EmailField(unique=True)
    user_type = models.PositiveSmallIntegerField(
        choices=UserType.choices,
        default=UserType.BRAND_AMBASSADOR,
        db_index=True,
        help_text='1=Head Office, 2=Admin, 3=Store Manager, 4=Brand Ambassador',
    )
    ho_role = models.CharField(
        max_length=20,
        choices=HoRole.choices,
        default=HoRole.STANDARD,
        db_index=True,
        help_text='Head Office only: standard (full UI) or mis (hides Dashboard & Stock).',
    )
    phone = models.CharField(max_length=20, blank=True)
    city = models.CharField(
        max_length=100,
        blank=True,
        help_text='Head Office only: limits this user to one city (e.g. Lahore). Blank = every city.',
    )
    is_active_user = models.BooleanField(
        default=True,
        help_text='Soft-active flag independent of Django is_active.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        abstract = True

    def __str__(self):
        return f'{self.get_full_name() or self.email} ({self.get_user_type_display()})'

    @property
    def is_head_office(self):
        return self.user_type == UserType.HEAD_OFFICE

    @property
    def is_mis(self):
        return self.is_head_office and self.ho_role == HoRole.MIS

    @property
    def is_admin_user(self):
        return self.user_type == UserType.ADMIN

    @property
    def is_store_manager(self):
        return self.user_type == UserType.STORE_MANAGER

    @property
    def is_brand_ambassador(self):
        return self.user_type == UserType.BRAND_AMBASSADOR


class User(AbstractCoreUser):
    """Concrete auth user used by AUTH_USER_MODEL."""

    class Meta:
        verbose_name = 'user'
        verbose_name_plural = 'users'
        ordering = ['-created_at']
