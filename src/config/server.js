const express = require("express");
const userRoutes = require("../routes/userRoutes");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 6000;

//require("dotenv").config();

// Middleware to parse JSON
//app.use(json());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Import routes
//import userRoutes from "../routes/userRoutes";
app.use("/api/users", userRoutes);

app.use("*", (req, res, next) => {
  res.status(409).json({
    status: "Failed",
    message: "The endpoint route not found",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
