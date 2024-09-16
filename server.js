const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

const uploadDirectory = '/tmp/uploads/';
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({ dest: uploadDirectory });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const tasks = new Map();

app.use(express.static('public'));

async function checkApiKey() {
    try {
        await axios.get('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });
        console.log('API ключ дійсний');
        return true;
    } catch (error) {
        console.error('API ключ недійсний:', error.response ? error.response.data : error.message);
        return false;
    }
}

app.post('/start-analysis', upload.single('file'), async (req, res) => {
    if (!await checkApiKey()) {
        return res.status(401).json({ error: 'Недійсний API ключ' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const taskId = uuidv4();
    tasks.set(taskId, { status: 'processing', file: req.file });

    // Запускаем асинхронную обработку
    processAudioFile(taskId, req.file.path);

    res.json({ taskId });
});

app.get('/task-status/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);

    if (!task) {
        return res.status(404).json({ error: 'Завдання не знайдено' });
    }

    res.json(task);
});

async function processAudioFile(taskId, filePath) {
    try {
        const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.mp3`);

        // Перекодуємо аудіо в mp3
        await new Promise((resolve, reject) => {
            ffmpeg(filePath)
                .toFormat('mp3')
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(outputPath);
        });

        console.log('Файл конвертовано в mp3');

        // Транскрибація
        const transcript = await transcribeAudio(outputPath);
        console.log('Транскрибацію завершено');

        // Аналіз голосу
        const voiceAnalysis = await analyzeVoice(transcript);
        console.log('Аналіз голосу завершено');

        // Аналіз змісту
        const contentAnalysis = await analyzeContent(transcript);
        console.log('Аналіз змісту завершено');

        // Оновлюємо статус завдання
        tasks.set(taskId, {
            status: 'completed',
            voiceAnalysis: voiceAnalysis,
            contentAnalysis: contentAnalysis
        });

        // Видаляємо тимчасові файли
        fs.unlinkSync(filePath);
        fs.unlinkSync(outputPath);

    } catch (error) {
        console.error('Помилка обробки файлу:', error);
        tasks.set(taskId, { status: 'failed', error: error.message });
    }
}

async function transcribeAudio(filePath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'uk');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    return response.data.text;
}

async function analyzeVoice(transcript) {
    const prompt = `Проаналізуйте голос у цій транскрипції: ${transcript}. Зосередьтеся на тоні, висоті, темпі та емоційних якостях.`;
    return await analyzeText(prompt);
}

async function analyzeContent(text) {
    const prompt = `Проаналізуйте цей транскрипт продажного дзвінка: ${text}. Оцініть: виявлення потреб, больові точки, презентацію, роботу із запереченнями та загальну ефективність продавця.`;
    return await analyzeText(prompt);
}

async function analyzeText(prompt) {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'chatgpt-4o-latest',
        messages: [
            { role: 'system', content: 'Ви - експерт з аналізу продажних дзвінків. Відповідайте українською мовою.' },
            { role: 'user', content: prompt }
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data.choices[0].message.content;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Сервер запущено на порту ${port}`);
});

module.exports = app; // Для використання з Vercel