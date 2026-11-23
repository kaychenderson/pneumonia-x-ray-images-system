from rest_framework.renderers import BaseRenderer


class PassthroughRenderer(BaseRenderer):
    """Evita 406 em endpoints que devolvem arquivos (imagem/PDF) via FileResponse/HttpResponse."""

    media_type = "*/*"
    format = ""
    charset = None
    render_style = "binary"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data
