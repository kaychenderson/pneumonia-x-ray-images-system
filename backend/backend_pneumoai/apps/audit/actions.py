class Actions:
    LOGIN = "auth.login"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    REGISTER = "auth.register"
    PASSWORD_RESET_REQUEST = "auth.password_reset_request"
    PASSWORD_RESET = "auth.password_reset"
    PASSWORD_CHANGE = "auth.password_change"

    PROFILE_UPDATE = "user.profile_update"
    USER_INVITE = "user.invite"
    USER_UPDATE = "user.update"

    PATIENT_CREATE = "patient.create"
    PATIENT_UPDATE = "patient.update"
    PATIENT_DELETE = "patient.delete"

    EXAM_CREATE = "exam.create"
    EXAM_UPDATE = "exam.update"
    EXAM_DELETE = "exam.delete"
    EXAM_IMAGE_VIEW = "exam.image_view"
    EXAM_ANALYZE = "exam.analyze"

    REPORT_DRAFT_SAVED = "report.draft_saved"
    REPORT_FINALIZE = "report.finalize"
    REPORT_REOPEN = "report.reopen"
    REPORT_PDF = "report.pdf"


ACTION_LABELS = {
    Actions.LOGIN: "Acesso à plataforma",
    Actions.LOGIN_FAILED: "Tentativa de acesso recusada",
    Actions.LOGOUT: "Sessão encerrada",
    Actions.REGISTER: "Cadastro profissional solicitado",
    Actions.PASSWORD_RESET_REQUEST: "Recuperação de senha solicitada",
    Actions.PASSWORD_RESET: "Senha redefinida",
    Actions.PASSWORD_CHANGE: "Senha alterada",
    Actions.PROFILE_UPDATE: "Perfil atualizado",
    Actions.USER_INVITE: "Usuário convidado",
    Actions.USER_UPDATE: "Usuário atualizado",
    Actions.PATIENT_CREATE: "Paciente cadastrado",
    Actions.PATIENT_UPDATE: "Paciente atualizado",
    Actions.PATIENT_DELETE: "Paciente removido",
    Actions.EXAM_CREATE: "Exame registrado",
    Actions.EXAM_UPDATE: "Exame atualizado",
    Actions.EXAM_DELETE: "Exame removido",
    Actions.EXAM_IMAGE_VIEW: "Imagem do exame visualizada",
    Actions.EXAM_ANALYZE: "Análise por IA executada",
    Actions.REPORT_DRAFT_SAVED: "Rascunho do laudo salvo",
    Actions.REPORT_FINALIZE: "Laudo finalizado",
    Actions.REPORT_REOPEN: "Laudo reaberto",
    Actions.REPORT_PDF: "PDF do laudo gerado",
}
