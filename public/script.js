document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const analyzeButton = document.getElementById('analyze-button');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');

    fileInput.addEventListener('change', () => {
        const fileName = fileInput.files[0]?.name || 'Виберіть аудіо файл';
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
        analyzeButton.disabled = true;

        try {
            const response = await fetch('/api/start-analysis', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const { taskId } = await response.json();
            await pollTaskStatus(taskId);
        } catch (error) {
            console.error('Помилка:', error);
            statusDiv.textContent = `Помилка: ${error.message}`;
        } finally {
            analyzeButton.disabled = false;
        }
    });

    async function pollTaskStatus(taskId) {
        const pollInterval = 5000; // 5 секунд
        const maxAttempts = 60; // Максимальное количество попыток (5 минут)
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                statusDiv.textContent = 'Обробка файлу...';
                const response = await fetch(`/api/task-status/${taskId}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();

                if (result.status === 'completed') {
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