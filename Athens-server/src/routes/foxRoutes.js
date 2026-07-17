import express from "express";
import { postFoxResolvedResume } from "../controllers/profileFoxController.js";

const router = express.Router();

router.post("/fox/resolved-resume", postFoxResolvedResume);

export default router;
