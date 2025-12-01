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

VIMEO_TOKEN= (token do vimeo da conta que criou o video que quer puxar a transcrição)

▶️ 3. Como rodar o Script

**Opção 1: Interface Web (Recomendado)**

1. Instale as dependências:
```bash
npm install
```

2. Inicie o servidor:
```bash
node server.js
```

3. Abra seu navegador em: `http://localhost:3000`

4. Cole a URL do vídeo do Vimeo e clique em "Processar Transcrição"

**Opção 2: Linha de Comando**

```bash
node downloadTranscript.js https://vimeo.com/video_escolhido
```

⚠️ Verificar se a disponibilidade de transcrição no video na plataforma vimeo

✅ 4. Arquivos Gerados

O script irá criar automaticamente 4 arquivos:

1. **transcript-{videoId}-{idioma}.vtt** - Formato original do Vimeo
2. **transcript-{videoId}-{idioma}.txt** - Versão tratada e formatada
3. **transcricaoAprimorada-{videoId}-{idioma}.txt** - Versão aprimorada pela IA com identificação de falantes
4. **resultado_qa-{videoId}-{idioma}.txt** - Perguntas e Respostas geradas automaticamente pela IA

🎨 5. Interface Web

A interface web utiliza as cores:
- **Branco** - Fundo principal
- **Azul** (#2563eb) - Títulos e elementos principais
- **Verde** (#10b981) - Botões e elementos de ação

Acesse `http://localhost:3000` após iniciar o servidor para usar a interface gráfica.
