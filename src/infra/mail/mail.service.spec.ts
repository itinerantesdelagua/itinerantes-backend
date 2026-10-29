import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import type { MailDriver } from './mail.types';
import { renderEmail } from './templates/base.template';

describe('MailService', () => {
  const driver: MailDriver = {
    name: 'console',
    send: jest.fn().mockResolvedValue({ driver: 'console' }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'MAIL_SUPPRESS_DOMAINS'
        ? ['demo.itinerantesdelagua.com']
        : 'EIA <no-reply@example.com>',
    ),
  };
  const service = new MailService(driver, config as unknown as ConfigService<never, true>);

  it('agrega el remitente configurado y delega en el driver', async () => {
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    await service.sendLayout('ana@example.com', 'Hola', { title: 'Hola', paragraphs: ['Texto'] });
    expect(driver.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'EIA <no-reply@example.com>',
        to: 'ana@example.com',
        subject: 'Hola',
        html: expect.stringContaining('<h1'),
        text: expect.stringContaining('Texto'),
      }),
    );
  });

  it('no envía a personas demo (MAIL_SUPPRESS_DOMAINS) y responde driver "suppressed"', async () => {
    (driver.send as jest.Mock).mockClear();
    const debug = jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
    const result = await service.send({
      to: 'Ana López <ana.lopez@DEMO.itinerantesdelagua.com>',
      subject: 'Pago confirmado',
      text: 'x',
    });
    expect(result).toEqual({ driver: 'suppressed' });
    expect(driver.send).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
  });

  it('con varios destinatarios solo quita los del dominio suprimido', async () => {
    (driver.send as jest.Mock).mockClear();
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    await service.send({
      to: ['equipo@itinerantesdelagua.com', 'x@demo.itinerantesdelagua.com'],
      subject: 'Aviso',
      text: 'x',
    });
    expect(driver.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['equipo@itinerantesdelagua.com'] }),
    );
  });

  it('rechaza mensajes sin contenido', async () => {
    await expect(service.send({ to: 'a@b.c', subject: 'x' })).rejects.toThrow();
  });

  it('la plantilla escapa HTML', () => {
    const { html } = renderEmail({ title: '<script>', paragraphs: ['a & b'] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('a &amp; b');
  });
});
