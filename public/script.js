document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('audio-file');
    const analyzeButton = document.getElementById('analyze-button');
    const loader = document.getElementById('loader');
    const stagesDiv = document.getElementById('stages');
    const resultDiv = document.getElementById('result');

    // Изначально скрываем лоадер и отключаем кнопку анализа
    loader.style.display = 'none';
    analyzeButton.disabled = true;

    fileInput.addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || 'Виберіть аудіо файл';
        e.target.nextElementSibling.querySelector('span').textContent = fileName;
        // Активируем кнопку анализа только когда выбран файл
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
        loader.style.display = 'flex'; // Показываем лоадер только при начале анализа
        analyzeButton.disabled = true;

        try {
            updateStage('Завантаження файлу', false);
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            updateStage('Завантаження файлу', true);
            updateStage('Обробка файлу', false);

            const result = await response.json();

            updateStage('Обробка файлу', true);
            updateStage('Аналіз голосу', true);
            updateStage('Аналіз змісту', true);

            loader.style.display = 'none'; // Скрываем лоадер после завершения анализа
            analyzeButton.disabled = false;

            resultDiv.innerHTML = `
                <h2>Результати аналізу:</h2>
                <h3>Аналіз голосу:</h3>
                <pre>${result.voiceAnalysis}</pre>
                <h3>Аналіз змісту:</h3>
                <pre>${result.contentAnalysis}</pre>
            `;
        } catch (error) {
            console.error('Помилка:', error);
            loader.style.display = 'none';
            analyzeButton.disabled = false;
            resultDiv.innerHTML = `<h2>Помилка</h2><pre>${error.message}</pre>`;
            updateStage('Помилка обробки', false);
        }
    });

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