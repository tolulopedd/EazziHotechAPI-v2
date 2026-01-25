const { Router } = require("express");
const { registerUser, loginUser, forgotPassword, resetPassword } = require("../controllers/userController");
const router = Router();

// Register route
router.post("/register", registerUser);

// Login route
router.post("/login", loginUser);

// Forgot password - sends a reset link (logged or emailed)
router.post("/forgot-password", forgotPassword);

// Reset password - accepts token + new password
router.post("/reset-password", resetPassword);

module.exports = router;