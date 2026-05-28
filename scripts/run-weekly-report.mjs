#!/usr/bin/env node
import "dotenv/config";
import { runMetaWeeklyReport } from "../dist/weekly-report.js";

const result = await runMetaWeeklyReport({
  writeClientReports: process.argv.includes("--write-repo"),
  skipSheets: process.argv.includes("--skip-sheets"),
});
console.log(JSON.stringify(result, null, 2));
if (result.status === "error") process.exit(1);
