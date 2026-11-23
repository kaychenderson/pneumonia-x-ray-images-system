"""Testes de integração da API. Rodam sem TensorFlow: a CNN é substituída por um classificador falso.

    python manage.py test
"""

import io
import re
import shutil
import tempfile
from datetime import date
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.exams.models import Exam
from apps.inference.service import ModelNotConfigured, Prediction
from apps.patients.models import Patient

MEDIA = tempfile.mkdtemp()
PASSWORD = "Senha-Forte-123"


def png_upload(name="rx.png", size=(256, 256)):
    buffer = io.BytesIO()
    Image.new("L", size, 120).save(buffer, "PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


class FakeClassifier:
    def predict(self, data):
        return Prediction(
            label="PNEUMONIA",
            probability_pneumonia=0.93,
            confidence=0.93,
            low_confidence=False,
            threshold=0.5,
            model_version="fake@1",
            inference_ms=5,
        )


class BrokenClassifier:
    def predict(self, data):
        raise ModelNotConfigured("Serviço de IA não configurado.")


FAKE = "apps.exams.services.get_classifier"


@override_settings(MEDIA_ROOT=MEDIA, ANALYZE_ON_CREATE=True)
class APITestCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.doctor = User.objects.create_user(
            "rafael@hospital.org", PASSWORD, name="Rafael Martins", registration="CRM 128.445"
        )
        self.other = User.objects.create_user(
            "helena@hospital.org", PASSWORD, name="Helena Dias", registration="CRM 99.100"
        )
        self.admin = User.objects.create_user(
            "admin@pneumoai.com.br", PASSWORD, name="Camila Oliveira", role=Role.ADMIN, registration="ADM-001"
        )
        self.patient = Patient.objects.create(full_name="Marina Alves Costa", birth_date=date(1987, 8, 14))

    # -- helpers ------------------------------------------------------------
    def create_exam(self, user=None, classifier=None):
        self.client.force_authenticate(user or self.doctor)
        with mock.patch(FAKE, return_value=classifier or FakeClassifier()):
            return self.client.post(
                "/api/exams/",
                {"patient": self.patient.pk, "projection": "PA", "notes": "tosse", "image": png_upload()},
                format="multipart",
            )

    # -- autenticação -------------------------------------------------------
    def test_login_returns_tokens_and_user(self):
        response = self.client.post(
            "/api/auth/login/", {"email": "RAFAEL@hospital.org", "password": PASSWORD}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["email"], "rafael@hospital.org")

    def test_login_wrong_password(self):
        response = self.client.post(
            "/api/auth/login/", {"email": "rafael@hospital.org", "password": "errada"}, format="json"
        )
        self.assertEqual(response.status_code, 401)

    def test_register_waits_for_approval(self):
        payload = {
            "name": "Novo Médico",
            "email": "novo@hospital.org",
            "password": PASSWORD,
            "registration": "CRM 1",
            "specialty": "Pneumologia",
        }
        response = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["requires_approval"])
        user = User.objects.get(email="novo@hospital.org")
        self.assertFalse(user.is_active)
        self.assertEqual(user.role, Role.DOCTOR)

        login = self.client.post(
            "/api/auth/login/", {"email": "novo@hospital.org", "password": PASSWORD}, format="json"
        )
        self.assertEqual(login.status_code, 401)
        self.assertEqual(login.data["code"], "inactive_account")

    def test_password_reset_flow(self):
        response = self.client.post(
            "/api/auth/password/forgot/", {"email": "rafael@hospital.org"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        uid, token = re.search(r"uid=([^&\s]+)&token=([^&\s]+)", mail.outbox[0].body).groups()
        reset = self.client.post(
            "/api/auth/password/reset/",
            {"uid": uid, "token": token, "new_password": "Outra-Senha-456"},
            format="json",
        )
        self.assertEqual(reset.status_code, 200)
        login = self.client.post(
            "/api/auth/login/", {"email": "rafael@hospital.org", "password": "Outra-Senha-456"}, format="json"
        )
        self.assertEqual(login.status_code, 200)

    def test_forgot_password_does_not_reveal_unknown_email(self):
        response = self.client.post("/api/auth/password/forgot/", {"email": "x@y.com"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    # -- pacientes ----------------------------------------------------------
    def test_patient_code_autogenerated_and_unique(self):
        self.client.force_authenticate(self.doctor)
        body = {"full_name": "Carlos Henrique Nunes", "birth_date": "1962-11-02"}
        created = self.client.post("/api/patients/", body, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertRegex(created.data["code"], r"^PAC-\d{5}$")
        duplicate = self.client.post(
            "/api/patients/", {**body, "code": created.data["code"]}, format="json"
        )
        self.assertEqual(duplicate.status_code, 400)

    def test_patient_with_exams_cannot_be_deleted(self):
        self.create_exam()
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f"/api/patients/{self.patient.pk}/")
        self.assertEqual(response.status_code, 409)

    # -- exames e IA --------------------------------------------------------
    def test_exam_create_runs_analysis_and_creates_report(self):
        response = self.create_exam()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertRegex(response.data["code"], r"^RX-\d{4}-\d{4}$")
        self.assertEqual(response.data["ai"]["status"], "completed")
        self.assertEqual(response.data["ai"]["label"], "PNEUMONIA")
        self.assertEqual(response.data["report"]["status"], "pending")
        self.assertEqual(response.data["physician"]["id"], self.doctor.pk)

    def test_exam_is_saved_even_if_model_is_unavailable(self):
        response = self.create_exam(classifier=BrokenClassifier())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["ai"]["status"], "failed")
        with mock.patch(FAKE, return_value=BrokenClassifier()):
            retry = self.client.post(f"/api/exams/{response.data['id']}/analyze/")
        self.assertEqual(retry.status_code, 503)
        self.assertEqual(retry.data["code"], "ai_unavailable")

    def test_invalid_image_is_rejected(self):
        self.client.force_authenticate(self.doctor)
        fake = SimpleUploadedFile("rx.png", b"isto nao e uma imagem", content_type="image/png")
        response = self.client.post(
            "/api/exams/", {"patient": self.patient.pk, "image": fake}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.data)
        self.assertEqual(Exam.objects.count(), 0)

    def test_image_is_only_served_to_authenticated_users(self):
        exam_id = self.create_exam().data["id"]
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/api/exams/{exam_id}/image/").status_code, 401)
        self.client.force_authenticate(self.other)
        response = self.client.get(f"/api/exams/{exam_id}/image/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        b"".join(response.streaming_content)

    # -- laudos -------------------------------------------------------------
    def test_report_flow(self):
        exam = self.create_exam().data
        report_id = exam["report"]["id"]
        url = f"/api/reports/{report_id}/"

        draft = self.client.patch(url, {"findings": "Opacidade em base direita."}, format="json")
        self.assertEqual(draft.status_code, 200)
        self.assertEqual(draft.data["status"], "draft")

        # outro médico não edita laudo alheio
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(url, {"findings": "x"}, format="json").status_code, 403)

        self.client.force_authenticate(self.doctor)
        missing = self.client.post(f"{url}finalize/", {}, format="json")
        self.assertEqual(missing.status_code, 400)

        done = self.client.post(
            f"{url}finalize/", {"conclusion": "Compatível com pneumonia."}, format="json"
        )
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(done.data["status"], "finalized")
        self.assertEqual(done.data["signature_registration"], "CRM 128.445")

        # imutável depois de finalizado
        self.assertEqual(self.client.patch(url, {"findings": "y"}, format="json").status_code, 409)
        self.assertEqual(self.client.post(f"/api/exams/{exam['id']}/analyze/").status_code, 409)

        # reabrir: só admin e com justificativa
        self.assertEqual(self.client.post(f"{url}reopen/", {"reason": "erro"}, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"{url}reopen/", {}, format="json").status_code, 400)
        reopened = self.client.post(f"{url}reopen/", {"reason": "Correção de lateralidade"}, format="json")
        self.assertEqual(reopened.data["status"], "draft")

    def test_report_pdf(self):
        exam = self.create_exam().data
        response = self.client.get(f"/api/reports/{exam['report']['id']}/pdf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF-"))

    def test_report_history_uses_audit_trail(self):
        exam = self.create_exam().data
        response = self.client.get(f"/api/reports/{exam['report']['id']}/history/")
        self.assertEqual(response.status_code, 200)
        labels = [event["label"] for event in response.data]
        self.assertIn("Exame registrado", labels)
        self.assertIn("Análise por IA executada", labels)

    # -- painel e administração --------------------------------------------
    def test_dashboard(self):
        self.create_exam()
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["cards"]["exams_total"], 1)
        self.assertEqual(response.data["cards"]["awaiting_review"], 1)
        self.assertEqual(response.data["cards"]["awaiting_review_priority"], 1)
        self.assertEqual(response.data["ai_distribution"]["pneumonia"]["count"], 1)
        self.assertEqual(len(response.data["exams_by_month"]), 12)

    def test_admin_only_endpoints(self):
        self.client.force_authenticate(self.doctor)
        for url in ("/api/users/", "/api/audit-logs/", "/api/admin/summary/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.client.force_authenticate(self.admin)
        for url in ("/api/users/", "/api/audit-logs/", "/api/admin/summary/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_admin_cannot_demote_self(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/users/{self.admin.pk}/", {"role": "doctor"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_invite_sends_email(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/users/invite/", {"email": "convidado@hospital.org", "role": "doctor"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["email_sent"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertFalse(User.objects.get(email="convidado@hospital.org").has_usable_password())

    def test_system_status(self):
        self.client.force_authenticate(self.doctor)
        response = self.client.get("/api/system/status/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("model", response.data)
