"""Geração do laudo em PDF (ReportLab). Independente do Django: recebe o objeto Report."""

import io
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image as RLImage
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#102844")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
BORDER = colors.HexColor("#CBD5E1")

LABELS_PT = {"NORMAL": "Normal", "PNEUMONIA": "Pneumonia"}


def _text(value):
    return escape(value or "").replace("\n", "<br/>")


def _fmt_dt(value, tz):
    if not value:
        return "—"
    if tz is not None and getattr(value, "tzinfo", None) is not None:
        value = value.astimezone(tz)
    return value.strftime("%d/%m/%Y %H:%M")


def _pct(value):
    return f"{value * 100:.1f}%".replace(".", ",")


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontSize=17, textColor=NAVY, alignment=0, spaceAfter=2),
        "sub": ParagraphStyle("sub", parent=base["Normal"], fontSize=9, textColor=SLATE),
        "h": ParagraphStyle("h", parent=base["Heading3"], fontSize=11, textColor=NAVY, spaceBefore=12, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base["Normal"], fontSize=10, leading=14),
        "small": ParagraphStyle("small", parent=base["Normal"], fontSize=8, leading=11, textColor=SLATE),
        "cell_k": ParagraphStyle("k", parent=base["Normal"], fontSize=8, textColor=SLATE),
        "cell_v": ParagraphStyle("v", parent=base["Normal"], fontSize=10, leading=12),
    }


def _info_table(rows, styles):
    data = [[Paragraph(_text(k), styles["cell_k"]), Paragraph(_text(v), styles["cell_v"])] for k, v in rows]
    table = Table(data, colWidths=[4.2 * cm, 12.8 * cm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, -1), LIGHT),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _xray_thumbnail(exam, max_cm=6.5):
    try:
        with exam.image.open("rb") as handle:
            data = handle.read()
        width, height = ImageReader(io.BytesIO(data)).getSize()
        scale = min(max_cm * cm / width, max_cm * cm / height)
        return RLImage(io.BytesIO(data), width=width * scale, height=height * scale)
    except Exception:  # noqa: BLE001 - a miniatura é opcional; o laudo não pode falhar por ela
        return None


def build_report_pdf(report, *, tz=None, generated_at=None):
    exam = report.exam
    patient = exam.patient
    physician = exam.physician
    finalized = report.status == "finalized"
    styles = _styles()
    generated_at = generated_at or datetime.now(tz)

    story = [
        Paragraph("Laudo de Radiografia de Tórax", styles["title"]),
        Paragraph(
            f"PneumoAI • Exame {_text(exam.code)} • {_text(report.get_status_display())}", styles["sub"]
        ),
        Spacer(1, 8),
        _info_table(
            [
                ("Paciente", f"{patient.full_name} ({patient.code})"),
                ("Nascimento / idade", f"{patient.birth_date:%d/%m/%Y} • {patient.age} anos"),
                ("Data do exame", f"{exam.exam_date:%d/%m/%Y}"),
                ("Projeção", exam.get_projection_display()),
                ("Médico responsável", f"{physician.name} • {physician.registration or 'registro não informado'}"),
            ],
            styles,
        ),
    ]

    thumb = _xray_thumbnail(exam)
    if thumb is not None:
        story += [Paragraph("Imagem analisada", styles["h"]), thumb]

    story += [
        Paragraph("Descrição dos achados", styles["h"]),
        Paragraph(_text(report.findings) or "—", styles["body"]),
        Paragraph("Impressão diagnóstica", styles["h"]),
        Paragraph(_text(report.conclusion) or "—", styles["body"]),
    ]

    if exam.ai_status == "completed" and exam.ai_label:
        ai_rows = [
            ("Classificação automática", LABELS_PT.get(exam.ai_label, exam.ai_label)),
            ("Probabilidade de pneumonia", _pct(exam.ai_probability)),
            ("Confiança na classe prevista", _pct(exam.ai_confidence)),
            ("Modelo", exam.ai_model_version or "—"),
        ]
        if exam.ai_low_confidence:
            ai_rows.append(("Atenção", "Confiança baixa: interpretar com cautela."))
        story.append(
            KeepTogether(
                [
                    Paragraph("Apoio à decisão por inteligência artificial (informativo)", styles["h"]),
                    _info_table(ai_rows, styles),
                    Spacer(1, 4),
                    Paragraph(
                        "Esta classificação é automática, não constitui diagnóstico e não substitui "
                        "a avaliação do médico. A conclusão acima reflete exclusivamente o profissional "
                        "responsável.",
                        styles["small"],
                    ),
                ]
            )
        )

    story.append(Spacer(1, 22))
    if finalized:
        story.append(
            KeepTogether(
                [
                    Paragraph("_" * 52, styles["body"]),
                    Paragraph(
                        f"<b>{_text(report.signature_name)}</b> • {_text(report.signature_registration)}",
                        styles["body"],
                    ),
                    Paragraph(f"Laudo finalizado em {_fmt_dt(report.finalized_at, tz)}", styles["small"]),
                ]
            )
        )
    else:
        story.append(
            Paragraph(
                "<b>DOCUMENTO NÃO FINALIZADO</b> — rascunho sem validade como laudo médico.",
                ParagraphStyle("warn", parent=styles["body"], textColor=colors.HexColor("#B45309")),
            )
        )

    def decorate(canvas, doc):
        canvas.saveState()
        if not finalized:
            canvas.setFont("Helvetica-Bold", 80)
            canvas.setFillColor(colors.Color(0.8, 0.84, 0.9, alpha=0.35))
            canvas.translate(A4[0] / 2, A4[1] / 2)
            canvas.rotate(45)
            canvas.drawCentredString(0, 0, "RASCUNHO")
            canvas.rotate(-45)
            canvas.translate(-A4[0] / 2, -A4[1] / 2)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(SLATE)
        canvas.drawString(2 * cm, 1.2 * cm, f"PneumoAI • {exam.code} • gerado em {_fmt_dt(generated_at, tz)}")
        canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Página {doc.page}")
        canvas.restoreState()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title=f"Laudo {exam.code}",
        author="PneumoAI",
    )
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()
