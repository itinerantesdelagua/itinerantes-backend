/** Mensaje de correo listo para enviar. `html` o `text` (idealmente ambos). */
export interface MailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface MailSendResult {
  /** Id del proveedor (si lo hay). */
  messageId?: string;
  /** `suppressed`: no se envió porque todos los destinatarios son de MAIL_SUPPRESS_DOMAINS. */
  driver: MailDriverName | 'suppressed';
}

export type MailDriverName = 'console' | 'smtp' | 'resend';

/** Contrato de un driver de correo. Para agregar otro proveedor implementa esta interfaz. */
export interface MailDriver {
  readonly name: MailDriverName;
  send(message: MailMessage & { from: string }): Promise<MailSendResult>;
}

/** Token de inyección del driver activo (seleccionado por MAIL_DRIVER). */
export const MAIL_DRIVER = Symbol('MAIL_DRIVER');
