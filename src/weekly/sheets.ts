import { markdownToSheetRows } from "./markdown.js";
import {
  createGoogleAuth,
  getSheetsApi,
  resolveSpreadsheetId,
  type GoogleAuthInfo,
} from "./google-auth.js";

export { createGoogleAuth, resolveSpreadsheetId, type GoogleAuthInfo };

export async function testGoogleSheetsAccess(
  spreadsheetId?: string
): Promise<{
  ok: boolean;
  auth: GoogleAuthInfo;
  spreadsheet_id: string;
  title?: string;
  tab_count: number;
  tabs: string[];
}> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const { info } = await createGoogleAuth();
  const sheets = await getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const tabs = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
  return {
    ok: true,
    auth: info,
    spreadsheet_id: id,
    title: meta.data.properties?.title ?? undefined,
    tab_count: tabs.length,
    tabs,
  };
}

export async function listSheetTabs(spreadsheetId?: string): Promise<string[]> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const sheets = await getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  return (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
}

export async function readSheetRange(
  spreadsheetId: string | undefined,
  sheetTitle: string,
  a1Range = "A:ZZ"
): Promise<string[][]> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const sheets = await getSheetsApi();
  const range = `'${sheetTitle.replace(/'/g, "''")}'!${a1Range}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function clearSheetTab(
  spreadsheetId: string | undefined,
  tabName: string
): Promise<void> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `'${tabName.replace(/'/g, "''")}'!A:ZZ`,
  });
}

export async function writeMarkdownTab(
  spreadsheetId: string,
  tabName: string,
  markdown: string,
  clearTab = true
): Promise<string> {
  const id = resolveSpreadsheetId(spreadsheetId);
  const sheets = await getSheetsApi();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const titles = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean)
  );

  if (!titles.has(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
  }

  if (clearTab) {
    await clearSheetTab(id, tabName);
  }

  const values = markdownToSheetRows(markdown);
  if (!values.length) {
    values.push(["(empty report)"]);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${tabName.replace(/'/g, "''")}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
