const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
require('dotenv').config();

// Налаштування логування
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

// Налаштування завантаження файлів
const uploadDirectory = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(uploadDirectory, { recursive: true });
      cb(null, uploadDirectory);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  logger.error('OPENAI_API_KEY is not set');
  process.exit(1);
}

const tasks = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Middleware для логування запитів
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/start-analysis', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const taskId = uuidv4();
    const model = req.body.model || 'chatgpt-4o-latest';
    tasks.set(taskId, { status: 'processing', progress: 0, file: req.file, model: model });

    // Запускаємо обробку в окремому процесі
    processAudioFile(taskId, req.file.path, model).catch(error => {
      logger.error('Error in processAudioFile:', error);
      tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
    });

    res.json({ taskId });
  } catch (error) {
    logger.error('Error in start-analysis:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера', details: error.message });
  }
});

app.get('/api/task-status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Завдання не знайдено' });
  }

  res.json(task);
});

async function processAudioFile(taskId, filePath, model) {
  const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.mp3`);

  try {
    await convertToMp3(filePath, outputPath, taskId);
    logger.info(`File converted to MP3 for task: ${taskId}`);
    
    const transcript = await transcribeAudio(outputPath, taskId);
    logger.info(`Audio transcribed for task: ${taskId}`);
    
    const analysis = await analyzeTranscript(transcript, taskId, model);
    logger.info(`Transcript analyzed for task: ${taskId}`);
    
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: analysis
    });

    // Видаляємо тимчасові файли
    await fs.unlink(filePath);
    await fs.unlink(outputPath);
  } catch (error) {
    logger.error(`Error processing audio file for task ${taskId}:`, error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  }
}

function convertToMp3(input, output, taskId) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .toFormat('mp3')
      .on('progress', (progress) => {
        updateTaskProgress(taskId, Math.min(progress.percent, 25));
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(output);
  });
}

async function transcribeAudio(filePath, taskId) {
  const formData = new FormData();
  formData.append('file', await fs.readFile(filePath), { filename: 'audio.mp3' });
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

    updateTaskProgress(taskId, 60);
    return response.data.text;
  } catch (error) {
    logger.error('Error in transcribeAudio:', error);
    throw new Error('Помилка при транскрибації аудіо');
  }
}

async function analyzeTranscript(transcript, taskId, model) {
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
      model: model,
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

    updateTaskProgress(taskId, 100);
    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error('Error in analyzeTranscript:', error);
    throw new Error('Помилка при аналізі транскрипту');
  }
}

function updateTaskProgress(taskId, progress) {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    tasks.set(taskId, task);
  }
}

// Обробник помилок
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Внутрішня помилка сервера',
    details: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Сервер запущено на порту ${port}`);
});

module.exports = app;