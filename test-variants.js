const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

// ================= НАСТРОЙКИ =================
// ВПИШИТЕ СЮДА ID ВАШЕГО ОБЩЕГО ШАБЛОНА
const TEMPLATE_ID = 747; 

const BASE_URL = 'https://kombinator'; // Проверьте URL
const AUTH_FILE = './auth.json';
const MASTER_DATA_FILE = './data/master_data.json';
const CASES_FILE = './cases.txt';
const OUTPUT_DIR = './output/VARIANTS_TEST';

// ================= КОД =================
const agent = new https.Agent({ rejectUnauthorized: false });
const client = axios.create({ baseURL: BASE_URL, httpsAgent: agent, timeout: 60000 });

async function run() {
    console.log(`🚀 Запуск теста вариативности для шаблона ID ${TEMPLATE_ID}`);

    // 1. Проверки
    if (!fs.existsSync(AUTH_FILE)) throw new Error(`Нет файла авторизации: ${AUTH_FILE}`);
    if (!fs.existsSync(MASTER_DATA_FILE)) throw new Error(`Нет мастер-данных: ${MASTER_DATA_FILE}`);
    if (!fs.existsSync(CASES_FILE)) throw new Error(`Нет файла со списком кейсов: ${CASES_FILE}`);

    // 2. Чтение списка кейсов
    const cases = fs.readFileSync(CASES_FILE, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')); // Игнорим пустые и комменты

    if (cases.length === 0) throw new Error('Файл cases.txt пуст!');

    // 3. Авторизация
    const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    console.log('🔑 Авторизация...');
    const loginRes = await client.post('/api/v1/account/login', auth);
    const cookies = loginRes.headers['set-cookie'];
    console.log('✅ Вход выполнен.\n');

    // 4. Чтение данных
    const masterData = JSON.parse(fs.readFileSync(MASTER_DATA_FILE, 'utf8'));

    // 5. Подготовка папки
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    console.log(`📋 Найдено вариантов кейсов: ${cases.length}\n`);

    // 6. Цикл по вариантам
    for (let i = 0; i < cases.length; i++) {
        const caseName = cases[i];

        // Клонируем данные
        const currentData = JSON.parse(JSON.stringify(masterData));

        // Убедимся, что путь существует
        if (!currentData.ответчикОбщий) currentData.ответчикОбщий = {};

        // === ПОДМЕНА ТИПА ДЕЛА ===
        currentData.ответчикОбщий.типСудебногоДела = caseName;
        // =========================

        // Формируем имя файла (удаляем запрещенные символы)
        const safeName = caseName.replace(/[\\/:*?"<>|]/g, '').substring(0, 50);
        const fileName = `${String(i + 1).padStart(2, '0')} - ${safeName}.docx`;

        process.stdout.write(`   [${i + 1}/${cases.length}] ${caseName}... `);

        try {
            const res = await client.post('/api/v2/templates/generatedocument', {
                templateId: TEMPLATE_ID,
                data: currentData,
                format: "docx"
            }, {
                headers: { 'Cookie': cookies },
                responseType: 'arraybuffer'
            });

            fs.writeFileSync(path.join(OUTPUT_DIR, fileName), res.data);
            console.log(`✅ OK`);
        } catch (e) {
            console.log(`❌ ОШИБКА`);
            const msg = e.response ? `Status: ${e.response.status}` : e.message;
            console.error(`      -> ${msg}`);
        }
    }

    console.log(`\n🏁 Готово! Результаты в папке: ${OUTPUT_DIR}`);
}

run().catch(err => {
    console.error('\n📛 Критическая ошибка:', err.message);
});