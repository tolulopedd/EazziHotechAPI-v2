const pgDev = require("../config/dbConfig");
const { createUser, findUserByEmail, updateUserPasswordById } = require("../dbQueries/userQueries");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const catchAsync = require("../../utils/catchAsync");

const secretKey = process.env.JWT_SECRET || "weBuiltTheSolution-4Africa";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

const registerUser = catchAsync(async (req, res) => {
  const { firstname, lastname, username, email, password, roleId, companyId } =
    req.body;

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return res.status(400).json({ message: "Email already in use" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await createUser({
    firstname,
    lastname,
    username,
    email,
    passwordHash,
    roleId,
    companyId,
    isActive: true,
    isVerified: false,
  });

  res.status(201).json({ message: "User registered successfully", user });
});

const loginUser = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await findUserByEmail(email);
 if (!user || user.is_active === false || user.status === "DISABLED") {
  return res.status(401).json({ message: "Invalid email or non active or disabled user" });
}


  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role_id, companyId: user.company_id },
    secretKey,
    { expiresIn: "1h" }
  );

  res.json({ message: "Login successful", token });
});

const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const user = await findUserByEmail(email);

  // Always return success to avoid account enumeration
  if (!user) {
    return res.json({ message: "If the email exists, a reset link has been sent" });
  }

  // Create a short-lived token
  const resetToken = jwt.sign(
    { id: user.id, email: user.email },
    secretKey,
    { expiresIn: "1h" }
  );

  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

  // TODO: Send real email via mailer (nodemailer / external API).
  // For now log the link (or integrate externalApiService).
  console.log(`Password reset link for ${email}: ${resetLink}`);

  return res.json({ message: "If the email exists, a reset link has been sent" });
});

const resetPassword = catchAsync(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ message: "Token and newPassword are required" });

  let payload;
  try {
    payload = jwt.verify(token, secretKey);
  } catch (err) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  const user = await findUserByEmail(payload.email);
  if (!user) return res.status(400).json({ message: "Invalid token" });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateUserPasswordById(user.id, passwordHash);

  res.json({ message: "Password has been reset successfully" });
});

module.exports = {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
};