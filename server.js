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

const uploadDirectory = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({ dest: uploadDirectory });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const tasks = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Middleware для логування запитів
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/start-analysis', upload.single('file'), (req, res) => {
  console.log('Received request to start analysis');
  try {
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'Файл не завантажено' });
    }

    console.log('File uploaded:', req.file);
    const taskId = uuidv4();
    const model = req.body.model || 'chatgpt-4o-latest';
    tasks.set(taskId, { status: 'processing', progress: 0, file: req.file, model: model });

    console.log(`Task created: ${taskId}`);
    // Запускаємо обробку в окремому процесі
    processAudioFile(taskId, req.file.path, model);

    res.json({ taskId });
  } catch (error) {
    console.error('Error in start-analysis:', error);
    res.status(500).json({ error: 'Внутрішня помилка сервера', details: error.message });
  }
});

app.get('/api/task-status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  console.log(`Checking status for task: ${taskId}`);
  const task = tasks.get(taskId);

  if (!task) {
    console.log(`Task not found: ${taskId}`);
    return res.status(404).json({ error: 'Завдання не знайдено' });
  }

  console.log(`Task status: ${JSON.stringify(task)}`);
  res.json(task);
});

function processAudioFile(taskId, filePath, model) {
  console.log(`Processing audio file for task: ${taskId}`);
  const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.mp3`);

  ffmpeg(filePath)
    .toFormat('mp3')
    .on('start', (commandLine) => {
      console.log('Spawned ffmpeg with command: ' + commandLine);
    })
    .on('progress', (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
      updateTaskProgress(taskId, Math.min(progress.percent, 25));
    })
    .on('end', () => {
      console.log('File has been converted successfully');
      updateTaskProgress(taskId, 25);
      transcribeAudio(outputPath, taskId, model);
    })
    .on('error', (err) => {
      console.error('Error:', err);
      tasks.set(taskId, { status: 'failed', progress: 100, error: err.message });
    })
    .save(outputPath);
}

function transcribeAudio(filePath, taskId, model) {
  console.log(`Transcribing audio for task: ${taskId}`);
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-1');
  formData.append('language', 'uk');

  axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
    headers: {
      ...formData.getHeaders(),
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  })
  .then(response => {
    console.log('Transcription completed');
    updateTaskProgress(taskId, 60);
    analyzeTranscript(response.data.text, taskId, model);
  })
  .catch(error => {
    console.error('Transcription error:', error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  });
}

function analyzeTranscript(transcript, taskId, model) {
  console.log(`Analyzing transcript for task: ${taskId}`);
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

  axios.post('https://api.openai.com/v1/chat/completions', {
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
  })
  .then(response => {
    console.log('Analysis completed');
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: response.data.choices[0].message.content
    });
  })
  .catch(error => {
    console.error('Analysis error:', error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  });
}

function updateTaskProgress(taskId, progress) {
  console.log(`Updating progress for task ${taskId}: ${progress}%`);
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    tasks.set(taskId, task);
  }
}

// Обробник помилок
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Щось пішло не так!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущено на порту ${port}`);
});

module.exports = app;