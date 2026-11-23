import datetime as dt
import ipaddress

from django.conf import settings


def get_client_ip(request):
    """IP do cliente. X-Forwarded-For só é considerado com TRUST_X_FORWARDED_FOR=True."""
    if request is None:
        return None
    meta = request.META
    if getattr(settings, "TRUST_X_FORWARDED_FOR", False):
        forwarded = meta.get("HTTP_X_FORWARDED_FOR", "")
        candidate = forwarded.split(",")[0].strip() if forwarded else ""
        if candidate:
            try:
                return str(ipaddress.ip_address(candidate))
            except ValueError:
                pass
    remote = meta.get("REMOTE_ADDR") or ""
    try:
        return str(ipaddress.ip_address(remote))
    except ValueError:
        return None


def initials(name):
    """'Marina Alves Costa' -> 'MC' (primeiro e último nome, como no front-end)."""
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def years_ago(today, years):
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29/02
        return today.replace(year=today.year - years, day=28)


def add_months(day, months):
    """Primeiro dia do mês deslocado em `months` (pode ser negativo)."""
    index = day.year * 12 + (day.month - 1) + months
    return dt.date(index // 12, index % 12 + 1, 1)
