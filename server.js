const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

const uploadDirectory = path.join('/tmp', 'uploads');
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({ dest: uploadDirectory });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const tasks = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/start-analysis', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не завантажено' });
  }

  const taskId = uuidv4();
  tasks.set(taskId, { status: 'processing', file: req.file });

  // Запускаем асинхронную обработку
  processAudioFile(taskId, req.file.path);

  res.json({ taskId });
});

app.get('/api/task-status/:taskId', (req, res) => {
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

    // Аналіз голосу та змісту
    const analysis = await analyzeTranscript(transcript);
    console.log('Аналіз завершено');

    // Оновлюємо статус завдання
    tasks.set(taskId, {
      status: 'completed',
      analysis: analysis
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

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return response.data.text;
  } catch (error) {
    console.error('Помилка транскрибації:', error);
    throw error;
  }
}

async function analyzeTranscript(transcript) {
    const prompt = `Проаналізуйте детально цей транскрипт продажного дзвінка:

    ${transcript}
    
    Надайте глибокий аналіз за наступними пунктами:
    
    1. Аналіз голосу:
       - Тон голосу (впевнений, невпевнений, дружній, агресивний тощо)
       - Темп мовлення (швидкий, повільний, змінний)
       - Емоційне забарвлення (ентузіазм, байдужість, зацікавленість)
       - Чіткість та зрозумілість мовлення
       - Паузи та їх доречність
    
    2. Виявлення потреб клієнта:
       - Які питання задавав продавець для виявлення потреб?
       - Наскільки глибоко продавець копав, щоб зрозуміти справжні потреби?
       - Чи вдалося продавцю виявити ключові болі клієнта?
    
    3. Презентація продукту чи послуги:
       - Наскільки презентація відповідала виявленим потребам клієнта?
       - Чи використовував продавець техніку особливість-перевага-вигода?
       - Наскільки переконливо були представлені унікальні торгові пропозиції?
    
    4. Робота із запереченнями:
       - Які заперечення висловлював клієнт?
       - Як продавець відреагував на кожне заперечення?
       - Чи використовував продавець техніки роботи з запереченнями (наприклад, "відчуваю, розумію, пропоную")?
    
    5. Техніки продажу:
       - Які конкретні техніки продажу використовував продавець (наприклад, соціальний доказ, дефіцит, авторитет)?
       - Наскільки ефективно ці техніки були застосовані?
    
    6. Закриття угоди:
       - Чи намагався продавець закрити угоду?
       - Які техніки закриття були використані?
       - Наскільки наполегливим був продавець у спробах закриття?
    
    7. Загальна ефективність продавця:
       - Оцініть загальну ефективність продавця за шкалою від 1 до 10
       - Які були сильні сторони продавця?
       - Які аспекти потребують покращення?
    
    8. Рекомендації щодо покращення:
       - Надайте 3-5 конкретних рекомендацій для підвищення ефективності продавця
    
    Будь ласка, надайте детальний аналіз по кожному пункту, підкріплюючи свої висновки конкретними прикладами з транскрипту.`;

  try {
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
  } catch (error) {
    console.error('Помилка аналізу:', error);
    throw error;
  }
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущено на порту ${port}`);
});

module.exports = app;