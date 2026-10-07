from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    user_type_label = serializers.CharField(source='get_user_type_display', read_only=True)

    class Meta:
        model = User
        fields = (
            'id',
            'email',
            'username',
            'first_name',
            'last_name',
            'user_type',
            'user_type_label',
            'ho_role',
            'phone',
            'city',
            'is_staff',
            'is_active',
        )
        read_only_fields = fields
