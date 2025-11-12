// =======================================
// routes/insightRoutes.js
// =======================================

import express from "express";
import { generateInsight } from "../controllers/insightController.js";

const router = express.Router();

// Define the route
router.get("/", generateInsight);

// Export the router
export default router;
