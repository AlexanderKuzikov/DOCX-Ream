const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

// ================= КОНФИГУРАЦИЯ =================
const CONFIG = {
    // Твой внутренний адрес (без /App)
    baseUrl: 'https://kombinator', 
    
    // Креды для входа
    auth: {
        email: "alexander@kuzikov.com",
        password: "12345"
    },
    
    // Папки
    inputDir: './scenarios', // Положи сюда свои JSON файлы (scenario_1.json и т.д.)
    outputDir: './output'    // Сюда упадут готовые DOCX
};

// Игнорируем ошибки самоподписанного сертификата (как флаг -k в curl)
const agent = new https.Agent({  
    rejectUnauthorized: false 
});

const client = axios.create({
    baseURL: CONFIG.baseUrl,
    httpsAgent: agent,
    validateStatus: () => true // Не падать при ошибках, а обрабатывать их
});

// ================= ОСНОВНАЯ ЛОГИКА =================

async function main() {
    console.log('🚀 Запуск генератора документов...');

    // 1. Создаем папку для результатов, если нет
    if (!fs.existsSync(CONFIG.outputDir)){
        fs.mkdirSync(CONFIG.outputDir);
    }

    try {
        // 2. Авторизация
        console.log('🔑 Авторизация...');
        const loginResponse = await client.post('/api/v1/account/login', CONFIG.auth);

        if (loginResponse.status !== 200) {
            throw new Error(`Ошибка входа! Статус: ${loginResponse.status}. Проверь пароль.`);
        }

        // Вытаскиваем куки из заголовков (это самое важное!)
        const cookies = loginResponse.headers['set-cookie'];
        if (!cookies) {
            throw new Error('Не пришли куки от сервера!');
        }
        console.log('✅ Успешный вход. Куки получены.');

        // 3. Чтение сценариев
        const files = fs.readdirSync(CONFIG.inputDir).filter(f => f.endsWith('.json'));
        console.log(`📂 Найдено сценариев: ${files.length}`);

        for (const file of files) {
            console.log(`\n📄 Обработка: ${file}...`);
            
            // Читаем JSON
            const rawData = fs.readFileSync(path.join(CONFIG.inputDir, file), 'utf8');
            const payload = JSON.parse(rawData);

            // 4. Генерация документа
            const genResponse = await client.post('/api/v2/templates/generatedocument', payload, {
                headers: {
                    'Cookie': cookies, // Передаем куки авторизации
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer' // Важно! Чтобы получить бинарник, а не текст
            });

            if (genResponse.status === 200) {
                // Сохраняем файл
                const ext = payload.format || 'docx';
                const outName = file.replace('.json', `.${ext}`);
                const outPath = path.join(CONFIG.outputDir, outName);
                
                fs.writeFileSync(outPath, genResponse.data);
                console.log(`✅ Сохранено: ${outPath}`);
            } else {
                console.error(`❌ Ошибка генерации! Статус: ${genResponse.status}`);
                // Если сервер вернул текст ошибки (json), попробуем показать
                try {
                    const errText = Buffer.from(genResponse.data).toString('utf8');
                    console.error('Детали:', errText.substring(0, 200));
                } catch (e) {}
            }
        }

    } catch (error) {
        console.error('\n📛 Критическая ошибка:', error.message);
    }
}

main();
