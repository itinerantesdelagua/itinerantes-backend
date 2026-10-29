import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEMO_EMAIL_DOMAIN } from '../../common/utils/demo';
import type { Env } from '../../config/env.schema';
import { MAIL_DRIVER } from './mail.types';
import type { MailDriver, MailMessage, MailSendResult } from './mail.types';
import { EmailLayoutOptions, renderEmail } from './templates/base.template';

/**
 * Servicio de correo. Los módulos de dominio dependen SOLO de esta clase; el proveedor real
 * (console / smtp / resend) se elige con MAIL_DRIVER.
 *
 * ```ts
 * await this.mail.sendLayout('persona@correo.com', 'Tu código de verificación', {
 *   title: 'Verifica tu correo',
 *   paragraphs: [`Tu código es ${code}. Vence en 10 minutos.`],
 * });
 * ```
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  /** Dominios a los que nunca se envía (MAIL_SUPPRESS_DOMAINS; por defecto el de los datos demo). */
  private readonly suppressedDomains: string[];

  constructor(
    @Inject(MAIL_DRIVER) private readonly driver: MailDriver,
    config: ConfigService<Env, true>,
  ) {
    this.from = config.get('MAIL_FROM', { infer: true });
    // Defensivo: sin la variable validada (p. ej. mocks de config) se suprime el dominio demo.
    const domains: unknown = config.get('MAIL_SUPPRESS_DOMAINS', { infer: true });
    this.suppressedDomains = Array.isArray(domains)
      ? domains.map((d) => String(d).toLowerCase())
      : [DEMO_EMAIL_DOMAIN];
  }

  get driverName(): MailDriver['name'] {
    return this.driver.name;
  }

  /**
   * Envía el correo. Los destinatarios de MAIL_SUPPRESS_DOMAINS (personas demo) se quitan; si no
   * queda ninguno no se envía nada y se responde `{ driver: 'suppressed' }` (quien llama lo trata
   * como enviado: p. ej. la notificación queda en `SENT`).
   */
  async send(message: MailMessage): Promise<MailSendResult> {
    if (!message.html && !message.text) {
      throw new Error('MailService.send requiere html o text');
    }
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const allowed = recipients.filter((to) => !this.isSuppressed(to));
    if (allowed.length === 0) {
      this.logger.debug(
        { subject: message.subject, recipients: recipients.length },
        'Correo omitido: destinatario de un dominio suprimido (datos demo)',
      );
      return { driver: 'suppressed' };
    }
    const to = Array.isArray(message.to) ? allowed : allowed[0];
    const result = await this.driver.send({ ...message, to, from: this.from });
    this.logger.log(
      { driver: result.driver, messageId: result.messageId, subject: message.subject },
      'Correo enviado',
    );
    return result;
  }

  /** `Nombre <a@b.c>` o `a@b.c` → ¿su dominio (o un subdominio) está suprimido? */
  private isSuppressed(address: string): boolean {
    const email = (/<([^>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
    const domain = email.slice(email.lastIndexOf('@') + 1);
    return this.suppressedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
  }

  /** Envía un correo con la plantilla base. */
  sendLayout(
    to: MailMessage['to'],
    subject: string,
    layout: EmailLayoutOptions,
  ): Promise<MailSendResult> {
    const { html, text } = renderEmail(layout);
    return this.send({ to, subject, html, text });
  }
}
