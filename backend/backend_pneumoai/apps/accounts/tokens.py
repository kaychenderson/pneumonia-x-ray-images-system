from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken


def revoke_user_tokens(user, keep_refresh=None):
    """Invalida todos os refresh tokens do usuário (exceto, opcionalmente, o da sessão atual).

    Access tokens já emitidos continuam válidos até expirar (JWT_ACCESS_MINUTES).
    """
    keep_jti = None
    if keep_refresh:
        try:
            keep_jti = RefreshToken(keep_refresh)["jti"]
        except TokenError:
            keep_jti = None
    tokens = OutstandingToken.objects.filter(user=user)
    if keep_jti:
        tokens = tokens.exclude(jti=keep_jti)
    for token in tokens.iterator():
        BlacklistedToken.objects.get_or_create(token=token)
