# PneumoAI — back-end (Django + DRF)

API do sistema de apoio à decisão clínica que classifica radiografias de tórax (NORMAL × PNEUMONIA)
com uma CNN DenseNet121. Atende o front-end PneumoAI (login, pacientes, exames, laudos, administração).

## Treino x servidor: o que vai no back-end?

Só o arquivo **`modelDenseNet121_Pneumonia.keras`**. O código de treino **não** é importado pelo Django;
está em `training/train_densenet121.py` apenas para reprodutibilidade (e fica fora da imagem Docker
se você o excluir). O serviço de inferência (`apps/inference/service.py`) replica o pré-processamento do treino:
RGB, 224×224 (`tf.image.resize` bilinear), pixels ÷ 255, saída sigmoid = P(PNEUMONIA), classes `[NORMAL, PNEUMONIA]`.

## Rodando localmente

    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt            # use tensorflow-cpu se não houver GPU
    cp .env.example .env
    cp /caminho/modelDenseNet121_Pneumonia.keras ml_models/

    # as migrations ainda não estão versionadas: gere-as uma vez e faça commit
    python manage.py makemigrations core accounts audit patients exams reports
    python manage.py migrate
    python manage.py createsuperuser           # login por e-mail
    python manage.py check_model               # valida o .keras (opcional: --image radiografia.jpeg)
    python manage.py runserver

Documentação interativa: `http://localhost:8000/api/docs/` (controlada por `ENABLE_API_DOCS`).
Testes (sem TensorFlow, a CNN é simulada): `python manage.py test`.

## Docker

    cp .env.example .env   # defina DJANGO_SECRET_KEY e POSTGRES_PASSWORD
    docker compose up --build

O modelo é montado de `./ml_models` em `/models`.

## Endpoints principais (prefixo `/api/`)

| Área | Rotas |
|---|---|
| Auth | `auth/login/`, `auth/refresh/`, `auth/logout/`, `auth/register/`, `auth/password/{forgot,reset,change}/`, `auth/me/`, `auth/me/avatar/` |
| Usuários (admin) | `users/`, `users/invite/` |
| Pacientes | `patients/` (busca, filtros de faixa etária e último exame) |
| Exames | `exams/` (upload + análise automática), `exams/{id}/analyze/` (reanálise), `exams/{id}/image/` (imagem original) |
| Laudos | `reports/`, `finalize/`, `reopen/`, `pdf/`, `history/` |
| Painel | `dashboard/`, `admin/summary/`, `audit-logs/` |
| Sistema | `health/`, `system/status/` (estado do modelo) |

## Pontos de atenção

- **Apoio à decisão, não diagnóstico.** A IA nunca preenche nem finaliza laudos; isso é do médico.
- A divisão treino/validação do script é por imagem, não por paciente, e as métricas do dataset público
  do Kaggle tendem a ser otimistas. Valide com dados do seu hospital antes de uso real.
- Cada worker do gunicorn carrega uma cópia do modelo na RAM (começa com 2 workers).
- Imagens são dados de saúde (LGPD): não são servidas por `MEDIA_URL`, só por `exams/{id}/image/`, que exige o header `Authorization`. No front, use `fetch()` + `URL.createObjectURL()` (um `<img src>` direto não envia o token).
- Use a mesma major de Keras/TensorFlow no treino e no servidor.
