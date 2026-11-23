# PneumoAI

Sistema web de **apoio à decisão clínica** que classifica radiografias de tórax como **NORMAL** ou **PNEUMONIA** usando uma CNN **DenseNet121**, com gestão de pacientes, exames, laudos médicos e auditoria.

> ⚠️ **Aviso importante:** a IA é uma ferramenta de apoio e **não é um diagnóstico**. A conclusão clínica e o laudo são sempre responsabilidade do médico. Este projeto não foi validado clinicamente nem aprovado por órgão regulador: não use com pacientes reais sem validação própria.

## Funcionalidades

- Login com JWT, cadastro profissional com aprovação do administrador, recuperação de senha e convite de usuários.
- Cadastro, busca, filtros e edição de pacientes (telefone com máscara `(84)98123-6789`).
- Upload de radiografia (PNG/JPEG) com análise automática pela CNN: classe, confiança, probabilidade, versão do modelo e aviso de baixa confiança.
- Histórico de exames com visualização da imagem e opção de refazer a análise.
- Laudos: rascunho, finalização com assinatura (nome + CRM), PDF, histórico de eventos e reabertura por administrador.
- Painel com indicadores e gráficos, trilha de auditoria e tema claro/escuro.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Back-end | Python, Django, Django REST Framework, SimpleJWT, SQLite (padrão) ou PostgreSQL/MySQL |
| IA | TensorFlow / Keras (DenseNet121, arquivo `.keras`) |
| Front-end | React, TypeScript, Vite, Tailwind CSS, Recharts |

## Estrutura do repositório

> Ajuste os nomes das pastas abaixo para os que você usou no seu repositório.

```
.
├── backend/           # API Django
│   ├── apps/          # accounts, patients, exams, reports, audit, inference, core
│   ├── config/        # settings, urls
│   ├── ml_models/     # coloque aqui o arquivo .keras do modelo
│   ├── training/      # script de treino (referência, não é usado pelo servidor)
│   └── requirements.txt
└── frontend/          # interface React
    ├── src/app/       # App.tsx e api.ts
    └── package.json
```

## Pré-requisitos

- **Python 3.11 ou 3.12** (o TensorFlow não costuma ter pacote para versões muito novas ou muito antigas)
- **Node.js 18 ou superior** (inclui o `npm`)
- **Git**
- O **modelo treinado** `modelDenseNet121_Pneumonia.keras` (veja a próxima seção)

## O modelo de IA

O arquivo do modelo **não está no repositório** (é grande e é um artefato de treino). O servidor precisa apenas desse arquivo; o código de treino não é executado pelo Django.

Para gerá-lo, use o script `backend/training/train_densenet121.py`, que baixa o dataset público [Chest X-Ray Images (Pneumonia)](https://www.kaggle.com/datasets/paultimothymooney/chest-xray-pneumonia) do Kaggle e treina a rede. No fim ele salva `modelDenseNet121_Pneumonia.keras`.

Depois, copie o arquivo para `backend/ml_models/modelDenseNet121_Pneumonia.keras` (ou aponte outro caminho em `MODEL_PATH` no `.env`).

Contrato que o servidor assume (precisa coincidir com o treino):

| Item | Valor |
|---|---|
| Entrada | RGB 224×224, redimensionamento bilinear |
| Normalização | pixels ÷ 255 (feita no servidor) |
| Saída | 1 neurônio sigmoid = probabilidade de PNEUMONIA |
| Ordem das classes | `NORMAL`, `PNEUMONIA` |
| Limiar | 0,5 |

> O dataset do Kaggle é composto por radiografias frontais de **crianças**. O modelo não é adequado, sem nova validação, para adultos ou para incidência em perfil.

## Como rodar

Use **dois terminais** (um para o back-end, outro para o front-end). Os comandos abaixo são para **Windows (PowerShell)**; no macOS/Linux, as diferenças estão indicadas.

### 1. Back-end

```powershell
cd backend\backend_pneumoai

python -m venv venv
venv\Scripts\activate            # macOS/Linux: source venv/bin/activate

python -m pip install --upgrade pip
pip install -r requirements.txt  # o TensorFlow é grande: pode demorar
```

Crie o arquivo de configuração:

```powershell
copy .env.example .env           # macOS/Linux: cp .env.example .env
```

Abra o `.env` e confira, no mínimo:

```
DJANGO_DEBUG=True
DJANGO_SECRET_KEY=troque-por-um-texto-longo-e-aleatorio
FRONTEND_URL=http://localhost:5173
```

Coloque o modelo em `ml_models/` e prepare o banco:

```powershell
python manage.py migrate
```

> Se a pasta `apps/<app>/migrations/` não existir (primeira vez, sem migrations versionadas), gere-as antes:
> `python manage.py makemigrations core accounts audit patients exams reports`

Crie o primeiro usuário (administrador) e valide o modelo:

```powershell
python manage.py createsuperuser   # pede e-mail, nome e senha
python manage.py check_model       # deve terminar com "OK - versão ..."
python manage.py runserver
```

A API sobe em `http://localhost:8000`. A documentação interativa fica em `http://localhost:8000/api/docs/` (ativa quando `DJANGO_DEBUG=True`).

O banco padrão é **SQLite**: o arquivo `db.sqlite3` é criado sozinho, não é preciso instalar nada.

### 2. Front-end

Em outro terminal:

```powershell
cd frontend
```

Crie o arquivo `.env` com a URL da API:

```
VITE_API_URL=http://localhost:8000/api
```

Instale e rode:

```powershell
npm install                        # se houver conflito: npm install --legacy-peer-deps
npm run dev
```

Abra `http://localhost:5173`.

## Primeiro acesso

1. Entre com o superusuário criado no passo anterior (e-mail + senha). Você cai na tela de **Administração**.
2. Em **Convidar usuário**, crie um médico. Em desenvolvimento os e-mails **não são enviados**: o link para definir a senha aparece no **terminal do back-end**. Cada link vale **uma única vez** (e por 24 horas).
3. Abra o link, defina a senha e entre como médico.
4. Em **Configurações → Perfil profissional**, preencha o **registro profissional (CRM)**. Sem ele, não é possível finalizar laudos.
5. Cadastre um paciente, vá em **Nova análise**, envie uma radiografia PNG/JPEG e abra o laudo.

> Pelo cadastro na tela de login, novos médicos ficam **aguardando aprovação** de um administrador. Para desativar isso em desenvolvimento, use `REGISTRATION_REQUIRES_APPROVAL=False` no `.env` do back-end.

## Variáveis de ambiente

**Back-end (`backend/.env`)**

| Variável | Descrição | Padrão |
|---|---|---|
| `DJANGO_DEBUG` | Modo desenvolvimento. **Nunca** `True` em produção | `False` |
| `DJANGO_SECRET_KEY` | Chave secreta do Django (obrigatória fora do debug) | — |
| `DJANGO_ALLOWED_HOSTS` | Hosts permitidos, separados por vírgula | `localhost,127.0.0.1` |
| `DATABASE_URL` | Banco de dados. Ex.: `postgres://user:senha@host:5432/db` | SQLite local |
| `FRONTEND_URL` | URL do front (usada nos links dos e-mails) | `http://localhost:5173` |
| `CORS_ALLOWED_ORIGINS` | Origens do front autorizadas a chamar a API | `http://localhost:5173` |
| `REGISTRATION_REQUIRES_APPROVAL` | Cadastros novos ficam inativos até aprovação | `True` |
| `EMAIL_BACKEND` | Backend de e-mail (em dev imprime no terminal) | console |
| `MODEL_PATH` | Caminho do arquivo `.keras` | `ml_models/modelDenseNet121_Pneumonia.keras` |
| `MODEL_THRESHOLD` | Limiar de decisão para PNEUMONIA | `0.5` |
| `MODEL_LOW_CONFIDENCE` | Abaixo disso, o resultado é marcado como baixa confiança | `0.70` |
| `ANALYZE_ON_CREATE` | Analisar automaticamente ao registrar o exame | `True` |
| `MAX_XRAY_UPLOAD_MB` | Tamanho máximo da radiografia | `15` |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_HOURS` | Validade dos tokens de acesso e de renovação | `15` / `12` |

**Front-end (`frontend/.env`)**

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API (sem barra no final) |

## Testes

```powershell
cd backend
python manage.py test
```

Os testes automatizados da API não precisam do TensorFlow: a CNN é substituída por um classificador simulado.

## Docker (opcional)

O back-end tem `Dockerfile` e `docker-compose.yml` (com PostgreSQL):

```powershell
cd backend
copy .env.example .env             # defina DJANGO_SECRET_KEY e POSTGRES_PASSWORD
docker compose up --build
```

O modelo é lido de `backend/ml_models` (montado em `/models` no contêiner).

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `venv\Scripts\activate` bloqueado no PowerShell | Rode `Set-ExecutionPolicy -Scope Process Bypass` e tente de novo |
| Erro ao instalar o TensorFlow | Confirme que o Python é 3.11 ou 3.12 (`python --version`) |
| "IA não configurada" na tela | O arquivo `.keras` não está no caminho de `MODEL_PATH`. Rode `python manage.py check_model` |
| Erro de CORS no console do navegador | Confira `CORS_ALLOWED_ORIGINS` e `FRONTEND_URL` no `.env` do back-end e reinicie o servidor |
| "Link inválido ou expirado" ao definir senha | O link é de uso único e morre se a senha mudar ou se o usuário já tiver entrado. Gere um novo convite |
| Front não carrega dados | Confirme que o back-end está rodando e que `VITE_API_URL` aponta para ele (reinicie o `npm run dev` após mudar o `.env`) |
| Ícone antigo do Vite na aba | Ctrl + F5 (o navegador guarda o favicon em cache) |
| Porta em uso | Rode o back-end em outra porta: `python manage.py runserver 8001` e ajuste `VITE_API_URL` |
