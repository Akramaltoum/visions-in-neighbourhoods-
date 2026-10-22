'use strict';

// Mailer interface: { send({ to, subject, text, html? }) => Promise<void> }.
// Transports, in order of preference:
//   1. Brevo HTTPS API (BREVO_API_KEY): works on hosts that block SMTP, like Render's free plan.
//   2. SMTP (SMTP_URL, or SMTP_USER + SMTP_PASS; defaults to Gmail).
//   3. Console logging, for local development only.
function createMailer(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config.brevoApiKey) {
    const senderEmail = config.mailFromEmail || config.smtpUser;
    const senderName = config.mailFromName || 'Vision In Neighborhoods';
    return {
      configured: true,
      async verify() {
        const res = await fetchImpl('https://api.brevo.com/v3/account', {
          headers: { 'api-key': config.brevoApiKey, accept: 'application/json' },
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const err = new Error(`Brevo rejected the API key (HTTP ${res.status}) ${detail.slice(0, 200)}`);
          // A short, safe reason for /healthz (no keys or IP addresses).
          err.reason = /\bip\b/i.test(detail) ? 'ip_not_authorized' : (res.status === 401 ? 'invalid_key' : `http_${res.status}`);
          throw err;
        }
        return true;
      },
      async send({ to, subject, text, html }) {
        const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: html || undefined,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Brevo send failed (HTTP ${res.status}) ${detail.slice(0, 200)}`);
        }
      },
    };
  }

  let transportOptions = null;
  if (config.smtpUrl) {
    transportOptions = config.smtpUrl;
  } else if (config.smtpUser && config.smtpPass) {
    transportOptions = {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      requireTLS: true,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    };
  }

  if (transportOptions) {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport(transportOptions);
    // Gmail rewrites the From address to the signed-in account anyway, so default to it.
    const from = config.mailFrom || (config.smtpUser ? `Vision In Neighborhoods <${config.smtpUser}>` : 'Vision In Neighborhoods <no-reply@example.com>');
    return {
      configured: true,
      verify: () => transport.verify(),
      async send({ to, subject, text, html }) {
        await transport.sendMail({ from, to, subject, text, html });
      },
    };
  }
  // No email transport configured: log instead of sending. Fine for local development only.
  return {
    configured: false,
    verify: async () => true,
    async send({ to, subject, text }) {
      console.log(`[mail:console] to=${to} subject="${subject}"\n${text}`);
    },
  };
}

module.exports = { createMailer };
