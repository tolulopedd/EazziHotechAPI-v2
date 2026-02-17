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
  propertyName?: string | null;
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

export async function sendGuestBookingEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: Booking Confirmation`;
  const html = lifecycleTemplate(
    "Booking Confirmed",
    "Your booking has been created successfully.",
    input,
    "Please contact the property team if any details need to be changed."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Booking confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendGuestCheckInEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: Check-in Confirmation`;
  const html = lifecycleTemplate(
    "Check-in Completed",
    "Your check-in has been completed successfully.",
    input,
    "We wish you a comfortable stay."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Check-in confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendGuestCheckOutEmail(input: SendGuestLifecycleEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const subject = `${appName}: Check-out Confirmation`;
  const html = lifecycleTemplate(
    "Check-out Completed",
    "Your check-out has been completed successfully.",
    input,
    "Thank you for staying with us."
  );
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Check-out confirmation for ${input.to} (booking ${input.bookingId})`,
  });
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
