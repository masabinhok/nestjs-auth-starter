import type { MailMessage } from './mail.service.js';

/**
 * Plain, dependency-free templates. Replace them with your own (MJML,
 * React Email) without touching the auth code: every flow calls these.
 */

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(
  title: string,
  body: string,
  link?: { url: string; label: string },
) {
  const button = link
    ? `<p><a href="${escape(link.url)}" style="display:inline-block;padding:10px 16px;background:#e0234e;color:#fff;border-radius:6px;text-decoration:none">${escape(link.label)}</a></p><p style="color:#666;font-size:13px">Or paste this link into your browser:<br>${escape(link.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>${escape(title)}</h2><p>${escape(body)}</p>${button}</body></html>`;
}

const expiry = (d: Date) => d.toUTCString();

export const templates = {
  verifyEmail(to: string, url: string, expiresAt: Date): MailMessage {
    const body = `Confirm this address to finish setting up your account. The link expires ${expiry(expiresAt)}.`;
    return {
      to,
      subject: 'Confirm your email address',
      text: `${body}\n\n${url}`,
      html: layout('Confirm your email', body, { url, label: 'Confirm email' }),
    };
  },

  resetPassword(to: string, url: string, expiresAt: Date): MailMessage {
    const body = `Someone asked to reset the password for this account. If it was you, choose a new password; otherwise ignore this email. The link expires ${expiry(expiresAt)}.`;
    return {
      to,
      subject: 'Reset your password',
      text: `${body}\n\n${url}`,
      html: layout('Reset your password', body, {
        url,
        label: 'Choose a new password',
      }),
    };
  },

  magicLink(to: string, url: string, expiresAt: Date): MailMessage {
    const body = `Use this link to sign in. It works once, in the browser that asked for it, until ${expiry(expiresAt)}.`;
    return {
      to,
      subject: 'Your sign-in link',
      text: `${body}\n\n${url}`,
      html: layout('Sign in', body, { url, label: 'Sign in' }),
    };
  },

  /** Sent instead of a second account, so signup does not reveal registered emails. */
  accountExists(to: string, loginUrl: string): MailMessage {
    const body = `Someone tried to create an account with this address, but you already have one. If it was you, sign in or reset your password.`;
    return {
      to,
      subject: 'You already have an account',
      text: `${body}\n\n${loginUrl}`,
      html: layout('You already have an account', body, {
        url: loginUrl,
        label: 'Sign in',
      }),
    };
  },

  passwordChanged(to: string): MailMessage {
    const body = `The password for your account was just changed and other devices were signed out. If this wasn't you, reset your password now.`;
    return {
      to,
      subject: 'Your password was changed',
      text: body,
      html: layout('Password changed', body),
    };
  },
};
