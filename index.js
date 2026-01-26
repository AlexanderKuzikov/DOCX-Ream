const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType } = require('docx');

// ================= КОНФИГУРАЦИЯ =================
const CONFIG = {
    baseUrl: 'https://kombinator',
    authFile: './auth.json',       // Вынесли авторизацию
    manifestFile: './manifest.json', // Справочник (БАЗА ЗНАНИЙ)
    queueFile: './templates.txt',    // Очередь (ЗАДАНИЕ НА СЕЙЧАС)
    dataDir: './data',
    outputDir: './output'
};

const agent = new https.Agent({ rejectUnauthorized: false });
const client = axios.create({ baseURL: CONFIG.baseUrl, httpsAgent: agent, timeout: 30000 });

// ... (Функция generateCover остается той же, что и раньше) ...
// Я её сократил для читаемости, но вставляй полную версию из прошлого ответа

async function generateCover(item, datasetNames) {
    // ... код генерации обложки ...
    // (Используй код из предыдущего шага, он был отличным)
    // Вернем заглушку для примера, чтобы код был короче здесь:
    return new Packer().toBuffer(new Document({ sections: [] })); 
}

function getSafeName(name) {
    return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

async function startBatch() {
    console.log('🚀 DOCX-Ream: Запуск по очереди templates.txt...\n');

    try {
        // 1. Проверки файлов
        if (!fs.existsSync(CONFIG.authFile)) throw new Error('Нет auth.json!');
        if (!fs.existsSync(CONFIG.manifestFile)) throw new Error('Нет manifest.json!');
        if (!fs.existsSync(CONFIG.queueFile)) throw new Error('Нет templates.txt!');

        // 2. Читаем конфиги
        const auth = JSON.parse(fs.readFileSync(CONFIG.authFile, 'utf8'));
        const manifest = JSON.parse(fs.readFileSync(CONFIG.manifestFile, 'utf8'));
        
        // Превращаем массив манифеста в удобный Map для быстрого поиска по ID
        // Ключ = ID (строкой), Значение = Объект шаблона
        const manifestMap = new Map(manifest.map(item => [String(item.id), item]));

        // 3. Читаем очередь (templates.txt)
        const queueIds = fs.readFileSync(CONFIG.queueFile, 'utf8')
            .split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('#')); // Игнорим пустые и комменты

        console.log(`📋 В очереди: ${queueIds.length} задач`);
        console.log(`📚 В реестре: ${manifestMap.size} описаний\n`);

        // 4. Авторизация
        console.log('🔑 Авторизация...');
        const loginRes = await client.post('/api/v1/account/login', auth);
        const cookies = loginRes.headers['set-cookie'];
        if (!cookies) throw new Error('Куки не получены!');
        console.log('✅ Вход выполнен.\n');

        // 5. Обработка очереди
        for (const id of queueIds) {
            const item = manifestMap.get(id);

            if (!item) {
                console.warn(`⚠️  ID ${id} не найден в manifest.json! Пропускаем.`);
                // Тут можно добавить логику "Default Run", если хочешь
                continue;
            }

            // Логика "Умной генерации" берется из Манифеста
            const folderName = `${getSafeName(item.case)} - ${item.id}`;
            const templateOutputDir = path.join(CONFIG.outputDir, folderName);

            console.log(`📂 [${id}] ${item.case}`);

            if (!fs.existsSync(templateOutputDir)) fs.mkdirSync(templateOutputDir, { recursive: true });

            // Генерируем обложку (нужно вставить полную функцию generateCover выше)
            try {
                // ВНИМАНИЕ: Тут нужен реальный вызов полной функции generateCover
                // const coverBuffer = await generateCover(item, item.datasets); 
                // fs.writeFileSync(path.join(templateOutputDir, '_ОБЛОЖКА.docx'), coverBuffer);
            } catch (e) { }

            // Проход по датасетам, указанным в Манифесте
            for (const dsName of item.datasets) {
                const dataPath = path.join(CONFIG.dataDir, `${dsName}.json`);
                
                if (!fs.existsSync(dataPath)) {
                    console.log(`   🔸 Нет данных: ${dsName}.json`);
                    continue;
                }

                const testData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                
                try {
                    const res = await client.post('/api/v2/templates/generatedocument', {
                        templateId: parseInt(id),
                        data: testData,
                        format: "docx"
                    }, {
                        headers: { 'Cookie': cookies },
                        responseType: 'arraybuffer'
                    });

                    fs.writeFileSync(path.join(templateOutputDir, `${dsName}.docx`), res.data);
                    console.log(`   ✅ ${dsName}`);
                } catch (e) {
                    console.error(`   ❌ ${dsName}: ${e.message}`);
                }
            }
            console.log(''); // Пустая строка между задачами
        }

        console.log('🏁 Очередь обработана!');

    } catch (err) {
        console.error('\n📛 Ошибка:', err.message);
    }
}

startBatch();
