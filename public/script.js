document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileLabel = document.querySelector('.file-label');
    const analyzeButton = document.getElementById('analyze-button');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressBar.appendChild(progressFill);

    fileInput.addEventListener('change', () => {
        const fileName = fileInput.files[0]?.name || 'Додати аудіо';
        document.querySelector('.file-text').textContent = fileName;
        analyzeButton.disabled = !fileInput.files.length;
    });

    analyzeButton.addEventListener('click', async () => {
        if (!fileInput.files.length) {
            alert('Будь ласка, виберіть аудіо файл');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        statusDiv.textContent = 'Завантаження файлу...';
        resultDiv.innerHTML = '';
        statusDiv.appendChild(progressBar);
        analyzeButton.disabled = true;
        
        fileInput.disabled = true;
        fileLabel.style.pointerEvents = 'none';
        fileLabel.style.opacity = '0.5';

        try {
            console.log('Відправка файлу на сервер...');
            const response = await fetch('/api/start-analysis', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP помилка! статус: ${response.status}`);
            }

            const { taskId } = await response.json();
            console.log('Отримано taskId:', taskId);
            await pollTaskStatus(taskId);
        } catch (error) {
            console.error('Помилка:', error);
            statusDiv.textContent = `Помилка: ${error.message}`;
        } finally {
            analyzeButton.disabled = false;
            fileInput.disabled = false;
            fileLabel.style.pointerEvents = '';
            fileLabel.style.opacity = '';
            document.querySelector('.file-text').textContent = 'Додати аудіо';
            fileInput.value = '';
            statusDiv.removeChild(progressBar);
        }
    });

    async function pollTaskStatus(taskId) {
        const pollInterval = 5000; // 5 секунд
        const maxAttempts = 60; // Максимальное количество попыток (5 минут)
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                console.log(`Перевірка статусу завдання ${taskId}...`);
                const progress = Math.min(Math.round((attempts / maxAttempts) * 100), 99);
                progressFill.style.width = `${progress}%`;
                statusDiv.textContent = `Обробка файлу... ${progress}%`;
                
                const response = await fetch(`/api/task-status/${taskId}`);
                if (!response.ok) {
                    throw new Error(`HTTP помилка! статус: ${response.status}`);
                }

                const result = await response.json();
                console.log('Отримано результат:', result);

                if (result.status === 'completed') {
                    progressFill.style.width = '100%';
                    statusDiv.textContent = 'Аналіз завершено';
                    resultDiv.innerHTML = `
                        <h2>Результати аналізу:</h2>
                        <pre>${result.analysis}</pre>
                    `;
                    return;
                } else if (result.status === 'failed') {
                    throw new Error('Помилка обробки завдання на сервері');
                }

                await new Promise(resolve => setTimeout(resolve, pollInterval));
                attempts++;
            } catch (error) {
                console.error('Помилка при перевірці статусу:', error);
                throw error;
            }
        }

        throw new Error('Перевищено час очікування результатів аналізу');
    }
});