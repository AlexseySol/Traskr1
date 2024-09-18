const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config();

const app = express();

// Використовуємо зберігання в пам'яті для Vercel
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // Обмеження 50MB

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set');
  process.exit(1);
}

const tasks = new Map();

app.use(express.static('public'));
app.use(express.json());

app.post('/api/start-analysis', upload.single('file'), async (req, res) => {
  try {
    console.log('Received request to start analysis');
    
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const taskId = uuidv4();
    const model = req.body.model || 'gpt-3.5-turbo';
    
    tasks.set(taskId, { 
      status: 'processing', 
      progress: 0,
      file: req.file.buffer,
      model: model 
    });

    console.log(`Task created: ${taskId}`);
    
    res.json({ taskId });

    // Запускаємо обробку асинхронно
    processAudio(taskId).catch(error => {
      console.error('Error in processAudio:', error);
      tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
    });

  } catch (error) {
    console.error('Error in start-analysis:', error);
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

async function processAudio(taskId) {
  const task = tasks.get(taskId);
  
  try {
    // Транскрибація
    updateTaskProgress(taskId, 30);
    const transcript = await transcribeAudio(task.file);
    
    // Аналіз
    updateTaskProgress(taskId, 60);
    const analysis = await analyzeTranscript(transcript, task.model);
    
    tasks.set(taskId, {
      status: 'completed',
      progress: 100,
      analysis: analysis
    });
  } catch (error) {
    console.error(`Error processing audio for task ${taskId}:`, error);
    tasks.set(taskId, { status: 'failed', progress: 100, error: error.message });
  }
}

async function transcribeAudio(audioBuffer) {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
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
    console.error('Error in transcribeAudio:', error);
    throw new Error('Помилка при транскрибації аудіо');
  }
}

async function analyzeTranscript(transcript, model) {
  try {
    // Читаємо правила з локального файлу
    const rulesPath = path.resolve(__dirname, 'communication_rules.json');
    console.log('Rules file path:', rulesPath);
    const rulesContent = await fs.readFile(rulesPath, 'utf8');
    const rules = JSON.parse(rulesContent);

    const prompt = `Проаналізуйте детально цей транскрипт продажного дзвінка, використовуючи наступні правила спілкування з клієнтами:

    ${JSON.stringify(rules, null, 2)}

    Транскрипт:
    ${transcript}
    
    Надайте глибокий аналіз за наступними пунктами:
    
    1. Мета дзвінка:
       - Чи досяг менеджер усіх ключових пунктів мети дзвінка?
       - Наскільки ефективно він мотивував клієнта щодо важливості зустрічі?
    
    2. Встановлення контакту:
       - Чи правильно менеджер привітався та представився?
       - Чи підтвердив він заявку клієнта та пояснив структуру розмови?
    
    3. Верифікація:
       - Чи задав менеджер усі необхідні питання для верифікації?
       - Як він впорався з питанням про ціну послуг?
    
    4. Призначення зустрічі (якщо лід підійшов за критеріями):
       - Чи надав менеджер всю необхідну інформацію про компанію та її послуги?
       - Наскільки ефективно він запропонував час для зустрічі?
       - Чи створив відчуття терміновості?
    
    5. Відмова (якщо лід не підійшов за критеріями):
       - Якщо була відмова, чи коректно менеджер її оформив?
       - Чи запропонував альтернативні варіанти взаємодії?
    
    6. Загальна оцінка:
       - Наскільки точно менеджер дотримувався скрипту?
       - Які були сильні сторони в роботі менеджера?
       - Які аспекти потребують покращення?
    
    7. Рекомендації:
       - Надайте 3-5 конкретних рекомендацій для підвищення ефективності роботи менеджера за цим скриптом.
    
    8. Порівняння з ідеальним скриптом продажів:
       - Створіть окремий розділ з назвою "Сравнение с идеальным скриптом продаж"
       - У цьому розділі порівняйте виконання менеджера з ідеальним скриптом по кожному етапу розмови
       - Вкажіть, які елементи скрипту були пропущені або змінені
       - Оцініть загальну відповідність розмови ідеальному скрипту у відсотках
    
    Будь ласка, надайте детальний аналіз по кожному пункту, підкріплюючи свої висновки конкретними прикладами з транскрипту та посилаючись на відповідні пункти скрипту.`;

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

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error in analyzeTranscript:', error);
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

// Для локального тестування
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

module.exports = app;