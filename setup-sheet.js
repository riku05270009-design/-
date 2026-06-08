// このスクリプトを一度だけ実行すると、Googleスプレッドシートが自動作成されます
// 実行方法: node setup-sheet.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(__dirname, 'google-credentials.json');
const SHEET_ID_FILE = path.join(__dirname, '.sheet_id');

async function setup() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error('❌ google-credentials.json が見つかりません。');
    console.error('   手順に従ってサービスアカウントのJSONキーをこのフォルダに置いてください。');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const drive = google.drive({ version: 'v3', auth: client });

  // スプレッドシート作成
  const sheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: '経費管理' },
      sheets: [{ properties: { title: '経費一覧' } }]
    }
  });
  const sheetId = sheet.data.spreadsheetId;

  // ヘッダー書き込み
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: '経費一覧!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['申請日時', '使用者', '金額', '通貨', '円換算額', '使用日', '経費区分', '使用内容', 'その他・備考']]
    }
  });

  // 誰でも閲覧できるように共有（オプション）
  await drive.permissions.create({
    fileId: sheetId,
    requestBody: { role: 'writer', type: 'anyone' }
  }).catch(() => {}); // 失敗しても続行

  // IDを保存
  fs.writeFileSync(SHEET_ID_FILE, sheetId);

  console.log('✅ スプレッドシートを作成しました！');
  console.log(`   URL: https://docs.google.com/spreadsheets/d/${sheetId}`);
  console.log('   このURLをブックマークしてください。');
  console.log('   次回からは申請するたびに自動でこのシートに追記されます。');
}

setup().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
