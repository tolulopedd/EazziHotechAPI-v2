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
  tenantPhone?: string | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
  unitName?: string | null;
  unitCapacity?: number | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null;
  totalAmount?: string | number | null;
  currency?: string | null;
  googleReviewUrl?: string | null;
};

type SendGuestPaymentAcknowledgementEmailInput = {
  to: string;
  guestName?: string | null;
  bookingId: string;
  tenantName?: string | null;
  tenantSlug?: string | null;
  tenantPhone?: string | null;
  propertyAddress?: string | null;
  amountPaid?: string | number | null;
  paymentDate?: Date | string | null;
  paymentMethod?: string | null;
  remainingBalance?: string | number | null;
};

type SendAdminDailyRevenueReportEmailInput = {
  to: string;
  tenantName: string;
  propertyAddress?: string | null;
  totalSalesRevenue: string | number;
  totalPayment: string | number;
  occupancyRatePercent: string | number;
  totalReceivables: string | number;
  reportDateLabel?: string;
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
  if (!Number.isFinite(amount)) return "—";
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
  const supportEmail = input.supportEmail?.trim() || process.env.SUPPORT_EMAIL || "";
  const tenantPhone = input.tenantPhone?.trim() || process.env.SUPPORT_PHONE || "—";
  const subject = `Booking Confirmation – ${propertyUnitLabel(input)}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.guestName?.trim() || "Guest Name")},</p>
      <p>Thank you for choosing ${escapeHtml(tenantSlug)}!</p>
      <p>We are delighted to confirm your reservation at ${escapeHtml(input.propertyAddress?.trim() || "our property")}. We look forward to ensure your stay is comfortable and memorable.</p>
      <p>Here are your booking details:</p>
      <p><b>Booking Reference:</b> #${escapeHtml(bookingShortId(input.bookingId))}</p>
      <p><b>Check-in Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkIn))} by 1:00pm</p>
      <p><b>Check-out Date:</b> ${escapeHtml(formatDateDdMonYyyy(input.checkOut))} by 12:00 Noon</p>
      <p><b>Room Type:</b> ${escapeHtml(input.unitName?.trim() || "—")}</p>
      <p><b>Number of Guests:</b> ${escapeHtml(String(input.unitCapacity ?? "—"))} Adult(s)</p>
      <p><b>Total Amount:</b> ₦${escapeHtml(formatNairaAmount(input.totalAmount))}</p>
      <p><b>IMPORTANT INFORMATION:</b><br/>
      - Please bring a valid ID (for profiling).<br/>
      - Mode of payment: Cash, Bank transfer and Debit Card<br/>
      - Cancellation Policy: Free cancellation 3 days before due date.<br/>
      - Refund Policy: No Refund.<br/>
      - Payment confirms booking. Room assignments are at the sole discretion of ${escapeHtml(tenantName)}.</p>
      <p>If you have any special requests (extra bed, late check-out, dietary needs, airport transfer, etc.), please contact us at ${escapeHtml(tenantPhone)}.</p>
      <p>We’re excited to host you soon!</p>
      <p>Warm regards,<br/>${escapeHtml(tenantName)}<br/>${escapeHtml(input.propertyAddress?.trim() || "Property Address")}<br/>${escapeHtml(String(supportEmail || tenantPhone))}</p>
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
  const supportPhone = input.tenantPhone?.trim() || process.env.SUPPORT_PHONE || "—";
  const subject = `Check-in Notification – Welcome to ${input.propertyName?.trim() || "Property"}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.guestName?.trim() || "Guest Name")},</p>
      <p>You are welcome to ${escapeHtml(input.propertyName?.trim() || "our property")}!</p>
      <p><b>Check-In Details:</b><br/>
      - Check-in Time: ${escapeHtml(formatTimeLagos(input.checkedInAt || input.checkIn))}<br/>
      - Room assigned: ${escapeHtml(input.unitName?.trim() || "—")}<br/>
      - Check-out Time: ${escapeHtml(formatDateDdMonYyyy(input.checkOut))} by 12:00 Noon</p>
      <p>Your room is prepared and waiting. For any needs (e.g., room upgrade, food order, dietary requests, expected visitor, stay extension), reach us at ${escapeHtml(supportPhone)}.</p>
      <p>We're excited to serve you!</p>
      <p>Warm regards,<br/>${escapeHtml(tenantName)}</p>
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
  const reviewUrl = input.googleReviewUrl?.trim() || process.env.GOOGLE_REVIEW_URL || "";
  const subject = "Check-out Notification – Thank You for Staying with Us";
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.guestName?.trim() || "Guest Name")},</p>
      <p>We truly enjoyed having you stay with us and hope your time at ${escapeHtml(tenantName)} was relaxing and everything you hoped for.</p>
      <p>Your feedback helps us improve and makes a big difference to our team. If you have a moment, we'd greatly appreciate it if you'd share your experience:</p>
      ${reviewUrl ? `<p><a href="${escapeHtml(reviewUrl)}">Leave a Google Review for us</a></p>` : ""}
      <p><b>Here's a Quick Recap of Your Stay:</b><br/>
      - Reservation: #${escapeHtml(bookingShortId(input.bookingId))}<br/>
      - Dates: ${escapeHtml(formatDateDdMonYyyy(input.checkIn))} to ${escapeHtml(formatDateDdMonYyyy(input.checkOut))}</p>
      <p>${escapeHtml(tenantSlug)} will love to welcome you back soon!</p>
      <p>Safe travels and best wishes,</p>
      <p>Warm regards,<br/>${escapeHtml(tenantName)}</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Check-out confirmation for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendGuestPaymentAcknowledgementEmail(input: SendGuestPaymentAcknowledgementEmailInput) {
  const appName = process.env.APP_NAME || "EazziHotech";
  const tenantName = input.tenantName?.trim() || appName;
  const slug = input.tenantSlug?.trim() || tenantName;
  const prefix = (slug.replace(/[^a-z0-9]/gi, "").slice(0, 3) || "EAZ").toUpperCase();
  const bookingRef = bookingShortId(input.bookingId);
  const receiptId = `${prefix}-${bookingRef}`;

  const subject = `Payment Acknowledgement – Booking #${bookingRef}`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.guestName?.trim() || "Guest Name")},</p>
      <p>Great news — we've received your payment!</p>
      <p>Your payment has been successfully processed, and your reservation is now confirmed.</p>
      <p><b>Payment Details:</b><br/>
      - Booking Reference: #${escapeHtml(bookingRef)}<br/>
      - Amount Paid: ₦${escapeHtml(formatNairaAmount(input.amountPaid))}<br/>
      - Payment Date: ${escapeHtml(formatDateDdMonYyyy(input.paymentDate))}<br/>
      - Method: ${escapeHtml(input.paymentMethod || "Manual")}<br/>
      - Remaining Balance: ₦${escapeHtml(formatNairaAmount(input.remainingBalance))}<br/>
      - Receipt ID: #${escapeHtml(receiptId)}</p>
      <p>We're excited to have you soon!</p>
      <p>Warm regards,<br/>${escapeHtml(tenantName)}<br/>${escapeHtml(input.propertyAddress?.trim() || "Property Address")}<br/>${escapeHtml(input.tenantPhone?.trim() || "—")}</p>
    </div>
  `;

  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Payment acknowledgement for ${input.to} (booking ${input.bookingId})`,
  });
}

export async function sendAdminDailyRevenueReportEmail(input: SendAdminDailyRevenueReportEmailInput) {
  const reportDate = input.reportDateLabel || "yesterday";
  const subject = `Revenue Report – ${input.tenantName} (${reportDate})`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <p>Dear ${escapeHtml(input.tenantName)} Admin,</p>
      <p>Here's ${escapeHtml(input.tenantName)}${input.propertyAddress ? `, ${escapeHtml(input.propertyAddress)}` : ""} business report for ${escapeHtml(reportDate)}:</p>
      <p>
      - Total Sales Revenue: ₦${escapeHtml(formatNairaAmount(input.totalSalesRevenue))}<br/>
      - Total Payment: ₦${escapeHtml(formatNairaAmount(input.totalPayment))}<br/>
      - Occupancy Rate: ${escapeHtml(String(input.occupancyRatePercent))}%<br/>
      - Total Receivables: ₦${escapeHtml(formatNairaAmount(input.totalReceivables))}
      </p>
      <p>Thank you.</p>
    </div>
  `;
  await sendEmailMessage({
    to: input.to,
    subject,
    html,
    consoleFallback: `[email] Daily revenue report for ${input.to} (${input.tenantName})`,
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
