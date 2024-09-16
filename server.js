const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
require('dotenv').config();
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

// Устанавливаем временную директорию для загрузки файлов
const uploadDirectory = '/tmp/uploads/';
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory);
}

const upload = multer({ dest: uploadDirectory });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

app.post('/analyze', upload.single('file'), async (req, res) => {
    if (!await checkApiKey()) {
        return res.status(401).json({ error: 'Недійсний API ключ' });
    }

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не завантажено' });
        }

        const filePath = req.file.path;
        const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.mp3`);

        console.log(`Обробка файлу: ${req.file.originalname}, розмір: ${req.file.size} байтів`);

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

        // Видаляємо тимчасові файли
        fs.unlinkSync(filePath);
        fs.unlinkSync(outputPath);

        res.json({
            voiceAnalysis: voiceAnalysis,
            contentAnalysis: contentAnalysis
        });
    } catch (error) {
        console.error('Деталі помилки:', error.response ? error.response.data : error);
        res.status(500).json({ error: 'Під час аналізу сталася помилка.', details: error.message });
    }
});

async function transcribeAudio(filePath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'uk'); // Вказуємо українську мову

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

app.listen(3000, () => {
    console.log('Сервер запущено на http://localhost:3000');
});
