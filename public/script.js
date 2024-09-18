document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileLabel = document.querySelector('.file-label');
    const analyzeButton = document.getElementById('analyze-button');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const modelRadios = document.querySelectorAll('input[name="model"]');
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
        formData.append('model', document.querySelector('input[name="model"]:checked').value);

        statusDiv.textContent = 'Завантаження файлу...';
        resultDiv.innerHTML = '';
        statusDiv.appendChild(progressBar);
        setFormDisabled(true);

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
            setFormDisabled(false);
            document.querySelector('.file-text').textContent = 'Додати аудіо';
            fileInput.value = '';
            if (statusDiv.contains(progressBar)) {
                statusDiv.removeChild(progressBar);
            }
        }
    });

    function setFormDisabled(disabled) {
        analyzeButton.disabled = disabled;
        fileInput.disabled = disabled;
        fileLabel.style.pointerEvents = disabled ? 'none' : '';
        fileLabel.style.opacity = disabled ? '0.5' : '';
        modelRadios.forEach(radio => radio.disabled = disabled);
    }

    async function pollTaskStatus(taskId) {
        const pollInterval = 5000; // 5 секунд
        while (true) {
            try {
                const response = await fetch(`/api/task-status/${taskId}`);
                if (!response.ok) {
                    throw new Error(`HTTP помилка! статус: ${response.status}`);
                }

                const result = await response.json();
                console.log('Отримано результат:', result);

                updateProgressBar(result.progress);

                if (result.status === 'completed') {
                    statusDiv.textContent = 'Аналіз завершено';
                    displayFormattedResults(result.analysis);
                    return;
                } else if (result.status === 'failed') {
                    throw new Error('Помилка обробки завдання на сервері');
                }

                await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (error) {
                console.error('Помилка при перевірці статусу:', error);
                statusDiv.textContent = `Помилка: ${error.message}`;
                return;
            }
        }
    }

    function displayFormattedResults(analysis) {
        const sections = analysis.split(/(?=###)/);
        let formattedHtml = '<div class="analysis-results">';

        sections.forEach(section => {
            const lines = section.trim().split('\n');
            const title = lines[0].replace(/^###\s*/, '').trim();
            const content = lines.slice(1).join('\n').trim();

            formattedHtml += `
                <div class="analysis-section">
                    <h2>${title}</h2>
                    <div class="section-content">
                        ${formatContent(content)}
                    </div>
                </div>
            `;
        });

        formattedHtml += '</div>';
        resultDiv.innerHTML = formattedHtml;
    }

    function formatContent(content) {
        // Форматування підзаголовків
        content = content.replace(/####\s*(.*)/g, '<h3>$1</h3>');

        // Форматування жирного тексту
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Форматування списків
        content = content.replace(/^-\s*(.*)/gm, '<li>$1</li>');
        content = content.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Форматування абзаців
        content = content.split('\n\n').map(p => `<p>${p}</p>`).join('');

        return content;
    }

    function updateProgressBar(progress) {
        progressFill.style.width = `${progress}%`;
        statusDiv.textContent = `Обробка файлу... ${progress}%`;
    }
});