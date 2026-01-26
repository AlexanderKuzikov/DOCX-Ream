const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
} = require('docx');

// ================= CONFIG =================
const PROJECT_ROOT = process.cwd();

const CONFIG = {
  baseUrl: 'https://kombinator',
  authFile: path.join(PROJECT_ROOT, 'auth.json'),
  manifestFile: path.join(PROJECT_ROOT, 'manifest.json'),
  queueFile: path.join(PROJECT_ROOT, 'templates.txt'),
  dataDir: path.join(PROJECT_ROOT, 'data'),
  outputDir: path.join(PROJECT_ROOT, 'output'),
};

const agent = new https.Agent({ rejectUnauthorized: false });
const client = axios.create({
  baseURL: CONFIG.baseUrl,
  httpsAgent: agent,
  timeout: 60000,
});

// ================= HELPERS =================
function getSafeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '').trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDatasetFileName(dsName) {
  const clean = String(dsName).trim();
  return clean.toLowerCase().endsWith('.json') ? clean : `${clean}.json`;
}

async function generateCover(item, datasetNames) {
  const now = new Date();
  const dateStr = now.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const title = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: 'ОБЛОЖКА ПАКЕТА ТЕСТИРОВАНИЯ',
        bold: true,
        size: 32,
      }),
    ],
  });

  const makeKeyCell = (text) =>
    new TableCell({
      shading: { fill: 'EFEFEF' },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true })],
        }),
      ],
    });

  const makeValCell = (text) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text: String(text ?? '') })],
        }),
      ],
    });

  const datasetParagraphs = datasetNames.length
    ? datasetNames.map((n) =>
        new Paragraph({
          children: [new TextRun({ text: `• ${n}` })],
        })
      )
    : [new Paragraph({ children: [new TextRun({ text: '—' })] })];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            shading: { fill: 'D9D9D9' },
            children: [title],
          }),
        ],
      }),
      new TableRow({
        children: [makeKeyCell('ID шаблона'), makeValCell(item.id)],
      }),
      new TableRow({
        children: [makeKeyCell('Кейс'), makeValCell(item.case)],
      }),
      new TableRow({
        children: [makeKeyCell('Дата/время прогона'), makeValCell(dateStr)],
      }),
      new TableRow({
        children: [makeKeyCell('Датасеты'), new TableCell({ children: datasetParagraphs })],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: '' }),
          table,
          new Paragraph({ text: '' }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

async function login(auth) {
  const loginRes = await client.post('/api/v1/account/login', auth);
  const cookies = loginRes.headers['set-cookie'];
  if (!cookies) throw new Error('Куки не получены (set-cookie пустой)');
  return cookies;
}

async function generateDocx(templateId, data, cookies) {
  const res = await client.post(
    '/api/v2/templates/generatedocument',
    {
      templateId: Number(templateId),
      data,
      format: 'docx',
    },
    {
      headers: { Cookie: cookies },
      responseType: 'arraybuffer',
    }
  );
  return res.data;
}

// ================= MAIN =================
async function startBatch() {
  console.log('🚀 DOCX-Ream: запуск');
  console.log(`📂 PROJECT_ROOT: ${PROJECT_ROOT}`);

  // Preconditions
  for (const f of [CONFIG.authFile, CONFIG.manifestFile, CONFIG.queueFile]) {
    if (!fs.existsSync(f)) throw new Error(`Не найден файл: ${f}`);
  }
  if (!fs.existsSync(CONFIG.dataDir)) throw new Error(`Не найдена папка data: ${CONFIG.dataDir}`);
  if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  const auth = readJson(CONFIG.authFile);
  const manifest = readJson(CONFIG.manifestFile);

  const manifestMap = new Map(manifest.map((x) => [String(x.id), x]));

  const queueIds = fs
    .readFileSync(CONFIG.queueFile, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));

  console.log(`📚 Шаблонов в manifest.json: ${manifestMap.size}`);
  console.log(`📋 Задач в templates.txt: ${queueIds.length}`);

  const cookies = await login(auth);
  console.log('✅ Авторизация OK');

  for (const id of queueIds) {
    const item = manifestMap.get(String(id));
    if (!item) {
      console.warn(`⚠️  ID ${id} не найден в manifest.json — пропуск`);
      continue;
    }

    const folderName = `${getSafeName(item.case)} - ${item.id}`;
    const templateOutputDir = path.join(CONFIG.outputDir, folderName);
    if (!fs.existsSync(templateOutputDir)) fs.mkdirSync(templateOutputDir, { recursive: true });

    console.log(`\n📂 ${folderName}`);

    // Cover
    try {
      const coverBuffer = await generateCover(item, item.datasets || []);
      fs.writeFileSync(path.join(templateOutputDir, '_ОБЛОЖКА.docx'), coverBuffer);
      console.log('   📋 _ОБЛОЖКА.docx');
    } catch (e) {
      console.warn(`   ⚠️ Обложка: ${e.message}`);
    }

    // Datasets
    const datasets = Array.isArray(item.datasets) ? item.datasets : [];

    for (const dsName of datasets) {
      const fileName = normalizeDatasetFileName(dsName);
      const dataPath = path.join(CONFIG.dataDir, fileName);

      if (!fs.existsSync(dataPath)) {
        console.log(`   🔸 Нет данных: ${fileName}`);
        continue;
      }

      let raw = readJson(dataPath);
      // Поддержка старого формата: если файл содержит { data: {...} }, извлекаем
      if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') {
        raw = raw.data;
      }

      try {
        const buf = await generateDocx(item.id, raw, cookies);
        const outPath = path.join(templateOutputDir, fileName.replace(/\.json$/i, '.docx'));
        fs.writeFileSync(outPath, buf);
        console.log(`   ✅ ${fileName} -> ${path.basename(outPath)}`);
      } catch (e) {
        const msg = e?.response?.data ? `[HTTP] ${e.response.status}` : e.message;
        console.log(`   ❌ ${fileName}: ${msg}`);
      }
    }
  }

  console.log('\n🏁 Готово');
}

startBatch().catch((e) => {
  console.error('\n📛 Ошибка:', e.message);
  process.exitCode = 1;
});