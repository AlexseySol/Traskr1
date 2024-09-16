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

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/start-analysis', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не завантажено' });
  }

  const taskId = uuidv4();
  const model = req.body.model || 'chatgpt-4o-latest';
  tasks.set(taskId, { status: 'processing', progress: 0, file: req.file, model: model });

  // Запускаємо обробку в окремому процесі
  processAudioFile(taskId, req.file.path, model);

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

function processAudioFile(taskId, filePath, model) {
  const outputPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.mp3`);

  // Конвертація аудіо в mp3
  ffmpeg(filePath)
    .toFormat('mp3')
    .on('progress', (progress) => {
      updateTaskProgress(taskId, Math.min(progress.percent, 25));
    })
    .on('end', () => {
      console.log('Файл конвертовано в mp3');
      updateTaskProgress(taskId, 25);
      transcribeAudio(outputPath, taskId, model);
    })
    .on('error', (err) => {
      console.error('Помилка конвертації:', err);
      tasks.set(taskId, { status: 'failed', progress: 100, error: err.message });
    })
    .save(outputPath);
}

function transcribeAudio(filePath, taskId, model) {
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
    console.log('Транскрибацію завершено');
    updateTaskProgress(taskId, 60);
    analyzeTranscript(response.data.text, taskId, model);
  })
  .catch(error => {
    console.error('Помилка транскрибації:', error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  });
}

function analyzeTranscript(transcript, taskId, model) {
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
    console.log('Аналіз завершено');
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: response.data.choices[0].message.content
    });
  })
  .catch(error => {
    console.error('Помилка аналізу:', error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  });
}

function updateTaskProgress(taskId, progress) {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    tasks.set(taskId, task);
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