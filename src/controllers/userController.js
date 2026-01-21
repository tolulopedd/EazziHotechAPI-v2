const pgDev = require("../config/dbConfig");
const { createUser, findUserByEmail } = require("../dbQueries/userQueries");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const catchAsync = require("../../utils/catchAsync");

const secretKey = "weBuiltTheSolution-4Africa";

const registerUser = catchAsync(async (req, res) => {
  const { firstname, lastname, username, email, password, roleId, companyId } =
    req.body;

  // Check if user already exists
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return res.status(400).json({ message: "Email already in use" });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create new user with associated company ID
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

  // Find user by email
  const user = await findUserByEmail(email);
  if (!user || !user.is_active) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  // Verify password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  // Generate token

  const token = jwt.sign(
    { id: user.id, role: user.role_id, companyId: user.company_id },
    secretKey,
    { expiresIn: "1h" }
  );

  res.json({ message: "Login successful", token });
});

module.exports = {
  registerUser,
  loginUser,
};
