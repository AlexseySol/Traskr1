const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');

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
    const model = req.body.model || 'chatgpt-4o-latest';
    
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