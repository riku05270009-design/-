const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDS_PATH = path.join(__dirname, 'google-credentials.json');
const SHEET_ID_FILE = path.join(__dirname, '.sheet_id');

function getAuth() {
  if (!fs.existsSync(CREDS_PATH)) return null;
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

function getSheetId() {
  if (!fs.existsSync(SHEET_ID_FILE)) return null;
  return fs.readFileSync(SHEET_ID_FILE, 'utf8').trim();
}

// 初回: ヘッダー行を書き込む
async function ensureHeader(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A1:I1'
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['申請日時', '使用者', '金額', '通貨', '円換算額', '使用日', '経費区分', '使用内容', 'その他・備考']]
      }
    });
  }
}

async function appendExpense(entry) {
  const auth = getAuth();
  const sheetId = getSheetId();
  if (!auth || !sheetId) return; // 未設定なら何もしない

  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    await ensureHeader(sheets, sheetId);

    const amountRaw = entry.amount;
    const currency = amountRaw.startsWith('$') || /USD/i.test(amountRaw) ? 'USD' : 'JPY';
    const jpyAmount = entry.jpyAmount != null ? entry.jpyAmount : (currency === 'JPY' ? (parseFloat(String(amountRaw).replace(/[^0-9.]/g, '')) || '') : '');

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date(entry.createdAt).toLocaleString('ja-JP'),
          entry.user,
          amountRaw,
          currency,
          jpyAmount,
          entry.date,
          entry.category,
          entry.description,
          entry.note || ''
        ]]
      }
    });
  } catch (e) {
    console.error('[Sheets] 書き込みエラー:', e.message);
  }
}

module.exports = { appendExpense, getAuth, getSheetId };
