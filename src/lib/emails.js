'use strict';

// Transactional emails. Every template returns { subject, text, html }.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f3f1ec;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border:1px solid #dcd8cf;border-radius:12px;" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-family:Georgia,serif;color:#1f2430;">Vision <span style="color:#2f5d8a;">In</span> Neighborhoods</td></tr>
<tr><td style="padding:8px 28px 28px;color:#1f2430;font-size:15px;line-height:1.55;">
<h1 style="margin:0 0 12px;font-size:22px;font-family:Georgia,serif;font-weight:400;">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table></td></tr></table></body></html>`;
}

function otpEmail({ code, ttlMinutes, name }) {
  const hello = name ? `Hi ${name}` : 'Your sign-in code';
  return {
    subject: `${code} is your Vision In Neighborhoods code`,
    text: `${hello},\n\nYour sign-in code is ${code}. It expires in ${ttlMinutes} minutes.\n\n`
      + "Never share this code. If you didn't try to sign in, ignore this email.",
    html: layout(hello, `
<p style="margin:0 0 18px;">Here's your sign-in code.</p>
<div style="font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;background:#f3f1ec;border:1px solid #2f5d8a;border-radius:8px;padding:16px;text-align:center;">${escapeHtml(code)}</div>
<p style="margin:18px 0 0;">It expires in <b>${ttlMinutes} minutes</b>. Never share it.</p>
<p style="margin:12px 0 0;color:#5d6472;font-size:13px;">If you didn't try to sign in, ignore this email.</p>`),
  };
}

module.exports = { otpEmail, escapeHtml };
