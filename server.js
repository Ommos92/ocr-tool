const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' })); // added for json payload

app.post('/api/save', (req, res) => {
  try {
    const { filename, markdown, annotations } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename missing' });

    const outDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir);
    }

    const base = path.parse(filename).name;
    const baseDir = path.join(outDir, base);
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }

    const mdPath = path.join(baseDir, `${base}.md`);
    fs.writeFileSync(mdPath, markdown, 'utf8');

    if (annotations && Object.keys(annotations).length > 0) {
      for (const [page, dataUrl] of Object.entries(annotations)) {
        if (!dataUrl) continue;
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(path.join(baseDir, `page_${page}_annotation.png`), base64Data, 'base64');
      }
    }

    res.json({ success: true, path: baseDir });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const prompt = req.body.prompt || 'Free OCR.';
  const base64Image = req.file.buffer.toString('base64');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Ensure headers are sent immediately

  try {
    const ollamaRes = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-ocr',
        prompt,
        images: [base64Image],
        stream: true,
      }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      res.write(`data: ${JSON.stringify({ error: `Ollama: ${errText}` })}\n\n`);
      res.end();
      return;
    }

    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep any incomplete trailing line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
          }
          if (parsed.done && !res.writableEnded) {
            res.write('data: [DONE]\n\n');
          }
        } catch {
          // skip malformed NDJSON lines
        }
      }
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // client disconnected, nothing to do
    console.error('Ollama error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to Ollama. Is it running?' });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OCR Tool running at http://localhost:${PORT}`);
});
