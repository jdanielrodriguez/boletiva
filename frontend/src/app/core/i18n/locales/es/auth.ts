/** Login, registro, recuperar/restablecer contraseña, invitación, 2FA. Español. */
export const auth = {
  // Login
  loginTitle: 'Iniciar sesión',
  loginSubtitle: 'Entra para comprar y gestionar tus boletos.',
  email: 'Correo',
  emailPlaceholder: 'tucorreo@ejemplo.com',
  password: 'Contraseña',
  signingIn: 'Entrando…',
  signIn: 'Entrar',
  forgot: '¿Olvidaste tu contraseña?',
  noAccount: '¿Aún no tienes cuenta?',
  registerLink: 'Regístrate',
  // 2FA
  code: 'Código',
  twofaEmail: 'Te enviamos un código de 6 dígitos a tu correo. Ingrésalo para continuar.',
  twofaApp: 'Ingresa el código de tu app de autenticación.',
  twofaEmailShort: 'Te enviamos un código de 6 dígitos a tu correo.',
  verifying: 'Verificando…',
  verify: 'Verificar',
  // Modal de login (en compra)
  modalTitle: 'Inicia sesión para pagar',
  modalSubtitle: 'Tu reserva sigue guardada. Solo necesitas identificarte para completar el pago.',
  // Recuperar
  recoverTitle: 'Recuperar contraseña',
  recoverSubtitle: 'Te enviaremos un enlace a tu correo para crear una nueva contraseña.',
  recoverSent:
    'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y el spam).',
  backToLogin: 'Volver a iniciar sesión',
  rememberedQ: '¿La recordaste?',
  sendLink: 'Enviar enlace',
  // Restablecer
  resetTitle: 'Restablecer contraseña',
  resetSubtitle: 'Elige una nueva contraseña para tu cuenta.',
  resetNoToken1: 'Enlace inválido o incompleto. Solicita un nuevo enlace desde',
  resetNoTokenLink: 'recuperar contraseña',
  newPassword: 'Nueva contraseña',
  confirmPassword: 'Confirmar contraseña',
  saving: 'Guardando…',
  resetSubmit: 'Restablecer contraseña',
  // Registro
  registerTitle: 'Crear cuenta',
  registerSubtitle: 'Regístrate para comprar boletos y gestionar tu cuenta.',
  firstName: 'Nombre',
  lastName: 'Apellido',
  creating: 'Creando…',
  createAccount: 'Crear cuenta',
  haveAccountQ: '¿Ya tienes cuenta?',
  loginLink: 'Inicia sesión',
  // Invitación de promotor
  invitationTitle: 'Invitación',
  invitationValidating: 'Validando tu invitación…',
  invitationInvalidTitle: 'Invitación no válida',
  invitationInvalidBody: 'La invitación no es válida o venció.',
  goToLogin: 'Ir a iniciar sesión',
  activateTitle: 'Activar cuenta de promotor',
  activateNote:
    'Fuiste invitado como <strong>promotor</strong> con el correo <strong>{{email}}</strong>. Ya tienes una cuenta con ese correo.',
  activating: 'Activando…',
  activateBtn: 'Activar mi cuenta de promotor',
  activateLoginNote:
    'Inicia sesión con <strong>{{email}}</strong> para activar tu rol de promotor.',
  invitedNote:
    'Fuiste invitado como <strong>promotor</strong>. Completa tus datos para activar tu cuenta.',
  // Mensajes (toasts / errores)
  msgInvitationInvalid: 'La invitación no es válida o venció.',
  msgCompleteFields: 'Completa nombre, correo y contraseña.',
  msgCreateFailed: 'No se pudo crear la cuenta (¿el correo ya está registrado?).',
  msgActivateOk: '¡Listo! Tu cuenta ahora es promotora. Vuelve a iniciar sesión para verlo.',
  msgActivateFailed: 'No se pudo activar (¿la invitación venció o ya la usaste?).',
  msgEnterEmail: 'Ingresa tu correo.',
  msgRecoverSent: 'Si el correo existe, te enviamos un enlace para restablecer tu contraseña.',
  msgInvalidCredentials: 'Credenciales inválidas.',
  msgInvalidCode: 'Código inválido o expirado.',
  msgNoToken: 'Enlace inválido: falta el token de recuperación.',
  msgPasswordMin: 'La contraseña debe tener al menos 8 caracteres.',
  msgConfirmMismatch: 'La confirmación no coincide.',
  msgResetOk: 'Contraseña restablecida. Ya puedes iniciar sesión.',
  msgResetFailed:
    'No se pudo restablecer: el enlace pudo expirar o ya fue usado. Solicita uno nuevo.',
};
