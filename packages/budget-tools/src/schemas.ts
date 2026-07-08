import { z } from "zod";

const gov = () => z.enum(["city", "county", "mps"]);

export const listDepartmentsShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional() };
export const getDepartmentBudgetShape = { dept: z.string(), gov: gov().default("city"), fiscal_year: z.number().int().optional(), doc_type: z.string().default("adopted") };
export const budgetBreakdownShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional(), dept: z.string().optional() };

export const compareYearsShape = { dept: z.string(), year_a: z.number().int(), year_b: z.number().int(), gov: gov().default("city") };
export const traceAdoptionShape = { dept: z.string(), fiscal_year: z.number().int(), gov: gov().default("city") };
export const biggestChangesShape = { gov: gov().default("city"), year_a: z.number().int(), year_b: z.number().int(), measure: z.enum(["dollars", "percent"]).default("dollars"), direction: z.enum(["up", "down", "both"]).default("both"), limit: z.number().int().max(40).default(12) };
export const getPositionsShape = { dept: z.string(), gov: gov().default("city"), fiscal_year: z.number().int().default(2026) };
export const findPositionsShape = { query: z.string().optional(), gov: gov().default("city"), fiscal_year: z.number().int().default(2026), min_salary: z.number().optional(), flag: z.string().optional(), limit: z.number().int().max(50).default(25) };
