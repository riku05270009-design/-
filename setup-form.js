// Googleフォームを自動作成してスプレッドシートに連携するスクリプト
// 実行方法: node setup-form.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(__dirname, 'google-credentials.json');
const SHEET_ID_FILE = path.join(__dirname, '.sheet_id');
const FORM_ID_FILE = path.join(__dirname, '.form_id');

async function setup() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const sheetId = fs.readFileSync(SHEET_ID_FILE, 'utf8').trim();

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/forms.body',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const client = await auth.getClient();
  const forms = google.forms({ version: 'v1', auth: client });
  const drive = google.drive({ version: 'v3', auth: client });
  const sheets = google.sheets({ version: 'v4', auth: client });

  // フォーム作成
  console.log('フォームを作成中...');
  const form = await forms.forms.create({
    requestBody: { info: { title: '経費申請フォーム', documentTitle: '経費申請フォーム' } }
  });
  const formId = form.data.formId;
  console.log('フォームID:', formId);

  // 質問を追加
  await forms.forms.batchUpdate({
    formId,
    requestBody: {
      requests: [
        // 使用者
        { createItem: { item: {
          title: '使用者',
          questionItem: { question: { required: true, textQuestion: { paragraph: false } } }
        }, location: { index: 0 } } },
        // 金額
        { createItem: { item: {
          title: '金額',
          description: '例: 1500　または　$120（ドルの場合は$をつける）',
          questionItem: { question: { required: true, textQuestion: { paragraph: false } } }
        }, location: { index: 1 } } },
        // 通貨
        { createItem: { item: {
          title: '通貨',
          questionItem: { question: { required: true, choiceQuestion: {
            type: 'RADIO',
            options: [{ value: '円（JPY）' }, { value: 'ドル（USD）' }]
          } } }
        }, location: { index: 2 } } },
        // 使用日
        { createItem: { item: {
          title: '使用日',
          questionItem: { question: { required: true, dateQuestion: {} } }
        }, location: { index: 3 } } },
        // 使用内容
        { createItem: { item: {
          title: '使用内容',
          questionItem: { question: { required: true, textQuestion: { paragraph: false } } }
        }, location: { index: 4 } } },
        // 経費区分
        { createItem: { item: {
          title: '経費区分',
          questionItem: { question: { required: true, choiceQuestion: {
            type: 'DROP_DOWN',
            options: [
              { value: '交通費' },
              { value: '交際費' },
              { value: '備品・消耗品' },
              { value: '通信費' },
              { value: '宿泊費' },
              { value: 'その他' }
            ]
          } } }
        }, location: { index: 5 } } },
        // その他・備考
        { createItem: { item: {
          title: 'その他・備考',
          questionItem: { question: { required: false, textQuestion: { paragraph: true } } }
        }, location: { index: 6 } } },
        // 領収書
        { createItem: { item: {
          title: '領収書（写真・PDF）',
          description: '任意。画像またはPDFをアップロードしてください。',
          questionItem: { question: { required: false, fileUploadQuestion: {
            folderId: 'root',
            types: ['ANY'],
            maxFiles: 1,
            maxFileSize: '10485760'
          } } }
        }, location: { index: 7 } } }
      ]
    }
  });

  // フォームをスプレッドシートに連携（Drive APIでフォームのdestinationを設定）
  console.log('スプレッドシートに連携中...');
  try {
    await forms.forms.batchUpdate({
      formId,
      requestBody: {
        requests: [{
          updateSettings: {
            settings: { quizSettings: { isQuiz: false } },
            updateMask: 'quizSettings'
          }
        }]
      }
    });
  } catch(e) {}

  // フォームのレスポンスをスプレッドシートに連携
  // Driveのスプレッドシートにフォームを紐付け
  try {
    await drive.files.update({
      fileId: formId,
      requestBody: {},
      addParents: sheetId
    });
  } catch(e) {}

  // フォームIDを保存
  fs.writeFileSync(FORM_ID_FILE, formId);

  // フォームを全員が回答できるよう公開
  try {
    await drive.permissions.create({
      fileId: formId,
      requestBody: { role: 'reader', type: 'anyone' }
    });
  } catch(e) { console.log('公開設定スキップ（手動で設定してください）'); }

  const formUrl = `https://docs.google.com/forms/d/${formId}/viewform`;
  console.log('\n✅ Googleフォームが完成しました！');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 回答フォームURL（これを共有）:');
  console.log(formUrl);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n⚠️  次のステップ:');
  console.log('1. 上のURLを開いてフォームの見た目を確認');
  console.log('2. フォーム編集画面の「回答」タブ → スプレッドシートアイコンをクリック');
  console.log(`3. 「既存のスプレッドシートを選択」→ 経費管理シートを選ぶ`);
}

setup().catch(e => {
  console.error('エラー:', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
