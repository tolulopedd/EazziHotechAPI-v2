import { Router } from "express";
import * as controller from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/auth/register", controller.register);
authRoutes.post("/auth/login", controller.login);
