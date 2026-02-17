type SendPasswordResetEmailInput = {
  to: string;
  resetLink: string;
  tenantName?: string | null;
};

type SendGuestLifecycleEmailInput = {
  to: string;
  guestName?: string | null;
  bookingId: string;
  tenantName?: string | null;
  tenantSlug?: string | null;
  supportEmail?: string | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
  unitName?: string | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  totalAmount?: string | number | null;
  currency?: string | null;
};

function normalizeEmailFrom(value: string | undefined, appName: string) {
  const raw = (value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw) return `${appName} <onboarding@resend.dev>`;

  // Accept either "email@example.com" or "Name <email@example.com>"
  const simple = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const named = /^.+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/;
  if (simple.test(raw) || named.test(raw)) return raw;

  return `${appName} <onboarding@resend.dev>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function formatDateDdMonYyyy(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const day = parts.find((p) => p.type === "day")?.value ?? "—";
  const month = (parts.find((p) => p.type === "month")?.value ?? "—").toUpperCase();
  const year = parts.find((p) => p.type === "year")?.value ?? "—";
  return `${day}-${month}-${year}`;
}

function formatTimeLagos(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();

  if (hour === 12 && minute === 0 && dayPeriod === "pm") return "12:00 Noon";
  return d.toLocaleTimeString("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatNairaAmount(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bookingShortId(bookingId: string) {
  const id = String(bookingId || "").trim();
  if (!id) return "—";
  return id.slice(-8).toUpperCase();
}

function propertyUnitLabel(input: SendGuestLifecycleEmailInput) {
  const property = input.propertyName?.trim() || "—";
  const unit = input.unitName?.trim() || "—";
  return `${property} / ${unit}`;
}

function propertyAtAddressLabel(input: SendGuestLifecycleEmailInput) {
  const property = input.propertyName?.trim() || "—";
  const address = input.propertyAddress?.trim() || "—";
  return `${property} at ${address}`;
}

async function sendEmailMessage(input: {
  to: string;
  subject: string;
  html: string;
  consoleFallback: string;
}) {
  const provider = (process.env.EMAIL_PROVIDER || "CONSOLE").trim().toUpperCase();
  const appName = process.env.APP_NAME || "EazziHotech";
  const from = normalizeEmailFrom(process.env.EMAIL_FROM, appName);

  if (provider === "RESEND") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[email] EMAIL_PROVIDER=RESEND but RESEND_API_KEY is missing. Falling back to console output.");
      console.log(input.consoleFallback);
      return;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
    return;
  }

  console.log(input.consoleFallback);
}

export async function sendPasswordResetEmail(input: SendPasswordResetEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const tenantName = input.tenantName?.trim() || appName;
  const safeLink = escapeHtml(input.resetLink);
  const safeTenantName = escapeHtml(tenantName);

  const subject = `${appName}: Reset your password`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Password reset request</h2>
      <p style="margin: 0 0 12px;">A password reset was requested for your ${safeTenantName} account.</p>
      <p style="margin: 0 0 16px;">
        <a href="${safeLink}" style="background:#1d4ed8;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;display:inline-block;">
          Reset password
        </a>
      </p>
      <p style="margin: 0 0 8px;">If the button does not work, use this link:</p>
      <p style="margin: 0 0 12px; word-break: break-all;">
        <a href="${safeLink}">${safeLink}</a>
      </p>
      <p style="margin: 0; color: #6b7280;">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Password reset link for ${input.to}: ${input.resetLink}`,
  });
}

export async function sendGuestBookingEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const tenantName = input.tenantName?.trim() || appName;
  const tenantSlug = input.tenantSlug?.trim() || tenantName;
  const supportEmail = input.supportEmail?.trim() || process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || "";
  const subject = `Booking Confirmation - ${propertyUnitLabel(input)}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hello ${escapeHtml(input.guestName?.trim() || "Guest")},</p>
      <p>Your booking has been successfully created by the ${escapeHtml(tenantSlug)} Team.</p>
      <p><b>Workspace:</b> ${escapeHtml(tenantName)}</p>
      <p><b>Booking ID:</b> ${escapeHtml(bookingShortId(input.bookingId))}</p>
      <p><b>Property / Unit:</b> ${escapeHtml(propertyAtAddressLabel(input))} / ${escapeHtml(input.unitName?.trim() || "—")}</p>
      <p><b>Check-in:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkIn))} at ${escapeHtml(formatTimeLagos(input.checkIn))}</p>
      <p><b>Check-out:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkOut))} at ${escapeHtml(formatTimeLagos(input.checkOut))}</p>
      <p><b>Amount:</b> ₦${escapeHtml(formatNairaAmount(input.totalAmount))}</p>
      <p>Please proceed with payment in accordance with the ${escapeHtml(tenantName)} policy.</p>
      <p>If you require any assistance or clarification, kindly contact us. Thank you for choosing to stay with us.</p>
      <p>Kind regards,<br/>${escapeHtml(tenantName)} Team<br/>${escapeHtml(String(supportEmail))}</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Booking confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendGuestCheckInEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const tenantName = input.tenantName?.trim() || appName;
  const tenantSlug = input.tenantSlug?.trim() || tenantName;
  const supportEmail = input.supportEmail?.trim() || process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || "";
  const subject = `Check-in Confirmation - Welcome to ${input.propertyName?.trim() || "Your Property"}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hello ${escapeHtml(input.guestName?.trim() || "Guest")},</p>
      <p>Your check-in has been successfully completed by the ${escapeHtml(tenantSlug)} Team.</p>
      <p><b>Workspace:</b> ${escapeHtml(tenantName)}</p>
      <p><b>Booking ID:</b> ${escapeHtml(bookingShortId(input.bookingId))}</p>
      <p><b>Property / Unit:</b> ${escapeHtml(propertyAtAddressLabel(input))} / ${escapeHtml(input.unitName?.trim() || "—")}</p>
      <p><b>Check-in Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkIn))} at ${escapeHtml(formatTimeLagos(input.checkIn))}</p>
      <p><b>Check-out Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkOut))} at ${escapeHtml(formatTimeLagos(input.checkOut))}</p>
      <p><b>Amount:</b> ₦${escapeHtml(formatNairaAmount(input.totalAmount))}</p>
      <p>We are pleased to welcome you and hope you have a comfortable and enjoyable stay.</p>
      <p>If you need any assistance during your stay, please do not hesitate to contact us.</p>
      <p>Kind regards,<br/>${escapeHtml(tenantName)} Team<br/>${escapeHtml(String(supportEmail))}</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Check-in confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendGuestCheckOutEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const tenantName = input.tenantName?.trim() || appName;
  const tenantSlug = input.tenantSlug?.trim() || tenantName;
  const supportEmail = input.supportEmail?.trim() || process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || "";
  const subject = "Check-out Confirmation - Thank You for Staying with Us";
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Hello ${escapeHtml(input.guestName?.trim() || "Guest")},</p>
      <p>Your check-out has been successfully completed by the ${escapeHtml(tenantSlug)} Team.</p>
      <p><b>Workspace:</b> ${escapeHtml(tenantName)}</p>
      <p><b>Booking ID:</b> ${escapeHtml(bookingShortId(input.bookingId))}</p>
      <p><b>Property / Unit:</b> ${escapeHtml(propertyAtAddressLabel(input))} / ${escapeHtml(input.unitName?.trim() || "—")}</p>
      <p><b>Check-in Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkIn))} at ${escapeHtml(formatTimeLagos(input.checkIn))}</p>
      <p><b>Check-out Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkOut))} at ${escapeHtml(formatTimeLagos(input.checkOut))}</p>
      <p><b>Amount:</b> ₦${escapeHtml(formatNairaAmount(input.totalAmount))}</p>
      <p>Thank you for choosing to stay with us. We hope you had a pleasant experience and look forward to hosting you again.</p>
      <p>Kind regards,<br/>${escapeHtml(tenantName)} Team<br/>${escapeHtml(String(supportEmail))}</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Check-out confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

function lifecycleTemplate(
  title: string,
  intro: string,
  input: SendGuestLifecycleEmailInput,
  footer: string
) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeGuest = escapeHtml(input.guestName?.trim() || "Guest");
  const safeTenant = escapeHtml(input.tenantName?.trim() || appName);
  const safeProperty = escapeHtml(input.propertyName?.trim() || "—");
  const safeUnit = escapeHtml(input.unitName?.trim() || "—");
  const safeBookingId = escapeHtml(input.bookingId);
  const currency = escapeHtml((input.currency || "NGN").toUpperCase());
  const totalAmount = Number(input.totalAmount ?? 0);
  const amountText = Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount.toFixed(2) : "—";

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">${safeTitle}</h2>
      <p style="margin: 0 0 12px;">Hello ${safeGuest},</p>
      <p style="margin: 0 0 16px;">${safeIntro}</p>
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f9fafb;">
        <p style="margin:0 0 8px;"><b>Workspace:</b> ${safeTenant}</p>
        <p style="margin:0 0 8px;"><b>Booking ID:</b> ${safeBookingId}</p>
        <p style="margin:0 0 8px;"><b>Property / Unit:</b> ${safeProperty} / ${safeUnit}</p>
        <p style="margin:0 0 8px;"><b>Check-in:</b> ${escapeHtml(formatDateTime(input.checkIn))}</p>
        <p style="margin:0 0 8px;"><b>Check-out:</b> ${escapeHtml(formatDateTime(input.checkOut))}</p>
        <p style="margin:0;"><b>Amount:</b> ${currency} ${escapeHtml(amountText)}</p>
      </div>
      <p style="margin: 16px 0 0; color: #6b7280;">${escapeHtml(footer)}</p>
    </div>
  `;
}

export async function sendAdminBookingAlertEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: New Booking Alert`;
  const html = lifecycleTemplate(
    "New Booking Created",
    `A booking has been created for ${input.guestName?.trim() || "a guest"}.`,
    input,
    "Review booking details and payment status in the dashboard."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Admin booking alert for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendAdminCheckInAlertEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: Guest Check-in Alert`;
  const html = lifecycleTemplate(
    "Guest Checked In",
    `${input.guestName?.trim() || "A guest"} has completed check-in.`,
    input,
    "Please ensure room-readiness and service notes are tracked."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Admin check-in alert for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendAdminCheckOutAlertEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: Guest Check-out Alert`;
  const html = lifecycleTemplate(
    "Guest Checked Out",
    `${input.guestName?.trim() || "A guest"} has completed check-out.`,
    input,
    "Review final settlement, room condition, and any damages or refunds."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Admin check-out alert for ${input.to} (booking ${input.bookingId})`,
  });
}
