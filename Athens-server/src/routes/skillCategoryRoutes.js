
import express from "express";
import { getSkillCategories } from "../controllers/skillCategoryController.js";

const router = express.Router();

router.get('/skills-category', getSkillCategories);

export default router;
