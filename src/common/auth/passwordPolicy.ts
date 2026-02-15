export function passwordPolicyErrors(password: string) {
  const errs: string[] = [];
  if (password.length < 10) errs.push("at least 10 characters");
  if (!/[A-Z]/.test(password)) errs.push("one uppercase letter");
  if (!/[a-z]/.test(password)) errs.push("one lowercase letter");
  if (!/[0-9]/.test(password)) errs.push("one number");
  if (!/[^A-Za-z0-9]/.test(password)) errs.push("one special character");
  return errs;
}

export function isStrongPassword(password: string) {
  return passwordPolicyErrors(password).length === 0;
}
