import { z } from "zod";

const gov = () => z.enum(["city", "county", "mps"]);

export const listDepartmentsShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional() };
export const getDepartmentBudgetShape = { dept: z.string(), gov: gov().default("city"), fiscal_year: z.number().int().optional(), doc_type: z.string().default("adopted") };
export const budgetBreakdownShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional(), dept: z.string().optional() };
