document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('audio-file');
    const analyzeButton = document.getElementById('analyze-button');
    const loader = document.getElementById('loader');
    const stagesDiv = document.getElementById('stages');
    const resultDiv = document.getElementById('result');

    loader.style.display = 'none';
    analyzeButton.disabled = true;

    fileInput.addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || 'Виберіть аудіо файл';
        e.target.nextElementSibling.querySelector('span').textContent = fileName;
        analyzeButton.disabled = !e.target.files[0];
    });

    analyzeButton.addEventListener('click', async () => {
        if (!fileInput.files[0]) {
            alert('Будь ласка, виберіть аудіо файл');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        stagesDiv.innerHTML = '';
        resultDiv.innerHTML = '';
        loader.style.display = 'flex';
        analyzeButton.disabled = true;

        try {
            updateStage('Завантаження файлу', false);
            const response = await fetch('/start-analysis', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const { taskId } = await response.json();
            updateStage('Завантаження файлу', true);
            updateStage('Обробка файлу', false);

            await pollTaskStatus(taskId);
        } catch (error) {
            console.error('Помилка:', error);
            updateStage('Помилка обробки', false);
            resultDiv.innerHTML = `<h2>Помилка</h2><pre>${error.message}</pre>`;
        } finally {
            loader.style.display = 'none';
            analyzeButton.disabled = false;
        }
    });

    async function pollTaskStatus(taskId) {
        const pollInterval = 5000; // 5 секунд
        const maxAttempts = 60; // Максимальное количество попыток (5 минут)
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`/task-status/${taskId}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();

                if (result.status === 'completed') {
                    updateStage('Обробка файлу', true);
                    updateStage('Аналіз голосу', true);
                    updateStage('Аналіз змісту', true);

                    resultDiv.innerHTML = `
                        <h2>Результати аналізу:</h2>
                        <h3>Аналіз голосу:</h3>
                        <pre>${result.voiceAnalysis}</pre>
                        <h3>Аналіз змісту:</h3>
                        <pre>${result.contentAnalysis}</pre>
                    `;
                    return;
                } else if (result.status === 'failed') {
                    throw new Error('Помилка обробки завдання на сервері');
                }

                // Если задача всё ещё выполняется, ждем и пробуем снова
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                attempts++;
            } catch (error) {
                console.error('Помилка при перевірці статусу:', error);
                throw error;
            }
        }

        throw new Error('Перевищено час очікування результатів аналізу');
    }

    function updateStage(stageName, isComplete) {
        const stageElement = document.createElement('div');
        stageElement.classList.add('stage');
        if (isComplete) {
            stageElement.classList.add('complete');
        }
        stageElement.textContent = stageName;
        stagesDiv.appendChild(stageElement);
    }
});