const form = document.getElementById('transcribeForm');
const submitBtn = document.getElementById('submitBtn');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const filesList = document.getElementById('filesList');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const videoUrl = document.getElementById('videoUrl').value.trim();
    
    if (!videoUrl) {
        showStatus('Por favor, insira uma URL válida', 'error');
        return;
    }

    // Desabilitar botão e mostrar loading
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').style.display = 'none';
    submitBtn.querySelector('.btn-loader').style.display = 'inline';
    
    // Esconder resultados anteriores
    resultsDiv.style.display = 'none';
    filesList.innerHTML = '';

    try {
        showStatus('⏳ Processando transcrição... Isso pode levar alguns minutos.', 'info');

        const response = await fetch('http://localhost:3000/api/transcribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ videoUrl })
        });

        const data = await response.json();

        if (data.success) {
            showStatus('✅ Transcrição processada com sucesso!', 'success');
            
            if (data.files && data.files.length > 0) {
                displayFiles(data.files);
            }
        } else {
            showStatus(`❌ Erro: ${data.error || 'Erro desconhecido'}`, 'error');
        }

    } catch (error) {
        console.error('Erro:', error);
        showStatus(`❌ Erro ao processar: ${error.message}`, 'error');
    } finally {
        // Reabilitar botão
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loader').style.display = 'none';
    }
});

function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';
}

function displayFiles(files) {
    filesList.innerHTML = '';
    files.forEach(file => {
        const li = document.createElement('li');
        
        // Criar container para o nome do arquivo e botão
        const fileContainer = document.createElement('div');
        fileContainer.className = 'file-item';
        
        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file;
        
        // Criar botão de download apenas para arquivos .txt
        if (file.endsWith('.txt') || file.endsWith('.vtt')) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn-download';
            downloadBtn.innerHTML = '⬇️ Download';
            downloadBtn.onclick = () => downloadFile(file);
            
            fileContainer.appendChild(fileName);
            fileContainer.appendChild(downloadBtn);
        } else {
            fileContainer.appendChild(fileName);
        }
        
        li.appendChild(fileContainer);
        filesList.appendChild(li);
    });
    resultsDiv.style.display = 'block';
}

function downloadFile(filepath) {
    const link = document.createElement('a');
    // O filepath já vem com o caminho relativo (ex: storage/2024-12-01/arquivo.txt)
    link.href = `http://localhost:3000/api/download/${filepath}`;
    // Extrair apenas o nome do arquivo para o download
    const filename = filepath.split('/').pop();
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

