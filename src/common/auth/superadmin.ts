function normalizeEmail(email?: string | null) {
  return (email || "").trim().toLowerCase();
}

function configuredSuperAdminEmails() {
  const items = [
    ...(process.env.SUPERADMIN_EMAILS || "").split(","),
    process.env.SUPERADMIN_EMAIL || "",
  ];

  return new Set(
    items
      .map((x) => normalizeEmail(x))
      .filter(Boolean)
  );
}

export function isSuperAdminEmail(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return configuredSuperAdminEmails().has(normalized);
}
