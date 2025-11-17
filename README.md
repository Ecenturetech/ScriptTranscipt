📄 README — Uso da Transcrição de Vídeos do Vimeo

Este documento explica como funciona a integração com a API de Transcrição (Captions) do Vimeo, e como utilizar o script que você criou para baixar a transcrição de um vídeo.

✅ 1. Visão Geral

A API do Vimeo permite acessar legendas e transcrições associadas aos vídeos. Cada legenda é um track que pode ser listado, acessado e baixado.

O fluxo é simples:

Você fornece o VIDEO_ID.

O sistema chama a API do Vimeo.

A API retorna a lista de transcrições disponíveis.

O script baixa o arquivo escolhido.

🔐 2. Pré‑Requisitos

Antes de usar a integração, você precisa:

1. Token de Acesso do Vimeo (Access Token)

Crie um .env contendo:

VIMEO_TOKEN=85c4cbe1aa9a33d63e0ef7e01adc26da

▶️ 3. Como rodar o Script

node downloadTranscript.js https://vimeo.com/video_escolhido

verificar se a disponibilidade de transcrição no video na plataforma vimeo

✅ 4. Como ver o trancrição

Irá criar dois arquivos transcript-xxx.vtt e transcript-xxx.txt, o vtt é o jeito real que vem do vimeo.
O .txt ja é tratado.
