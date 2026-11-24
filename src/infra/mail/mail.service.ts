import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends mail over SMTP (Mailpit at localhost:8025 in development), logs it
 * (`MAIL_TRANSPORT=log`), or keeps it in memory for tests
 * (`MAIL_TRANSPORT=memory`, read with `outbox`).
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  /** Messages sent with MAIL_TRANSPORT=memory, oldest first. */
  readonly outbox: MailMessage[] = [];

  constructor(@InjectEnv() private readonly env: Env) {
    if (env.MAIL_TRANSPORT === 'smtp') {
      this.transporter = nodemailer.createTransport(env.SMTP_URL);
    }
  }

  async send(message: MailMessage): Promise<void> {
    switch (this.env.MAIL_TRANSPORT) {
      case 'memory':
        this.outbox.push(message);
        return;
      case 'log':
        this.logger.log(
          `Mail to ${message.to}: ${message.subject}\n${message.text}`,
        );
        return;
      case 'smtp':
        await this.transporter!.sendMail({
          from: this.env.MAIL_FROM,
          ...message,
        });
    }
  }

  onModuleDestroy() {
    this.transporter?.close();
  }
}
