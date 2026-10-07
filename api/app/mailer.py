"""Outgoing e-mail for the online store (sign-in codes, order confirmations, "ready for pick-up").

EMAIL_BACKEND: "console" prints the message to the log (development), "smtp" uses any SMTP server (e.g. Gmail with an
app password), "resend" uses the Resend API. "memory" keeps messages in a list (tests). Sending NEVER raises into the
caller's request: a failed e-mail is logged and the order/sign-in carries on (the customer can always see the order
on the website).
"""

import base64
import logging
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage

import httpx

from .config import settings

log = logging.getLogger("mailer")
OUTBOX: list["Mail"] = []  # the "memory" backend (tests)


@dataclass
class Mail:
    to: str
    subject: str
    text: str
    html: str = ""
    attachments: list[tuple[str, bytes, str]] = field(default_factory=list)  # (file name, bytes, mime type)


def _smtp(m: Mail) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.email_from, m.to, m.subject
    msg.set_content(m.text)
    if m.html:
        msg.add_alternative(m.html, subtype="html")
    for name, data, mime in m.attachments:
        main, _, sub = mime.partition("/")
        msg.add_attachment(data, maintype=main, subtype=sub or "octet-stream", filename=name)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
        s.starttls()
        s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)


def _resend(m: Mail) -> None:
    body = {"from": settings.email_from, "to": [m.to], "subject": m.subject, "text": m.text}
    if m.html:
        body["html"] = m.html
    if m.attachments:
        body["attachments"] = [{"filename": n, "content": base64.b64encode(d).decode()} for n, d, _ in m.attachments]
    r = httpx.post("https://api.resend.com/emails", json=body, timeout=20,
                   headers={"Authorization": f"Bearer {settings.resend_api_key}"})
    r.raise_for_status()


def send(m: Mail) -> bool:
    """True if the message was handed to the backend."""
    try:
        backend = settings.email_backend
        if backend == "smtp":
            _smtp(m)
        elif backend == "resend":
            _resend(m)
        elif backend == "memory":
            OUTBOX.append(m)
        else:
            log.warning("E-MAIL to %s | %s\n%s", m.to, m.subject, m.text)
        return True
    except Exception:
        log.exception("could not send e-mail to %s (%s)", m.to, m.subject)
        return False
