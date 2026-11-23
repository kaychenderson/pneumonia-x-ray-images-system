from django.db import models, transaction


class Sequence(models.Model):
    """Contador atômico (códigos RX-AAAA-NNNN, PAC-NNNNN) sem corrida entre requisições."""

    name = models.CharField(max_length=64, unique=True)
    value = models.PositiveBigIntegerField(default=0)

    def __str__(self):
        return f"{self.name}={self.value}"

    @classmethod
    def next(cls, name):
        with transaction.atomic():
            obj, _ = cls.objects.select_for_update().get_or_create(name=name)
            obj.value += 1
            obj.save(update_fields=["value"])
            return obj.value
