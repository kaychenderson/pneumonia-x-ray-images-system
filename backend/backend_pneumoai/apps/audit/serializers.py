from rest_framework import serializers

from .actions import ACTION_LABELS
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "created_at",
            "user",
            "user_email",
            "action",
            "action_label",
            "object_type",
            "object_id",
            "object_repr",
            "ip_address",
            "metadata",
        )
        read_only_fields = fields

    def get_user(self, obj):
        return {"id": obj.user_id, "name": obj.user.name} if obj.user_id else None

    def get_action_label(self, obj):
        return ACTION_LABELS.get(obj.action, obj.action)
