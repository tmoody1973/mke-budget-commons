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

export const searchLineItemsShape = { query: z.string(), gov: gov().optional(), fiscal_year: z.number().int().optional(), limit: z.number().int().max(50).default(20) };
export const citeShape = { line_id: z.number().int() };
export const reconciliationStatusShape = { doc_id: z.string().optional() };
export const glossaryShape = { term: z.string().optional() };
export const runSqlShape = { query: z.string(), limit: z.number().int().max(1000).default(200) };
export const compareSchoolsShape = { school_a: z.string(), school_b: z.string(), fiscal_year: z.number().int().default(2027) };
export const mpsFundSummaryShape = { fiscal_year: z.number().int().default(2027) };
export const perPupilRankingShape = { fiscal_year: z.number().int().default(2027), order: z.enum(["highest", "lowest"]).default("highest"), min_enrollment: z.number().int().default(0), limit: z.number().int().max(60).default(20) };
// Layer-2 WPF context retrieval — semantic, secondary commentary (never figures).
export const explainShape = { question: z.string(), gov: gov().optional(), k: z.number().int().min(1).max(12).default(4) };

// Vendor payments (City Open Checkbook) — cash disbursements, never budget figures.
export const searchVendorPaymentsShape = { vendor: z.string().optional(), unit: z.string().optional(), account: z.string().optional(), year: z.number().int().optional(), min_amount: z.number().optional(), limit: z.number().int().max(50).default(20) };
export const getTopVendorsShape = { unit: z.string().optional(), year: z.number().int().optional(), limit: z.number().int().max(50).default(15) };
export const vendorPaymentSummaryShape = { unit: z.string().optional(), year: z.number().int().optional(), group_by: z.enum(["account", "fund", "year", "unit"]).default("account") };
export const compareBudgetToPaymentsShape = { department: z.string(), fiscal_year: z.number().int().optional() };
