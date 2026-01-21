const { Router } = require("express");
const { registerUser, loginUser } = require("../controllers/userController");
const router = Router();
const jwt = require("jsonwebtoken");

//import { registerUser, loginUser } from "../controllers/userController";

// Register route
router.post("/register", registerUser);

// Login route
router.post("/login", loginUser);

module.exports = router;
