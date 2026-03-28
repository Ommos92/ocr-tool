const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeSegment(value) {
  return (value || 'default')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
}

function detectionKey(page, type, bbox) {
  return `${page}|${type}|${bbox.join(',')}`;
}

function formatRefLine(page, type, bbox, assetPath) {
  const meta = `ref:${type} | page:${page} | bbox:[${bbox.join(', ')}]`;
  if (assetPath) {
    return `[${meta}](${assetPath})`;
  }
  return `_${meta}_`;
}

function formatBlock(block, assetMap) {
  const { page, type, bbox, content } = block;
  const key = detectionKey(page, type, bbox);
  const assetPath = assetMap.get(key);
  const parts = [];

  if (type === 'table' || type === 'image' || type === 'figure') {
    parts.push(formatRefLine(page, type, bbox, assetPath));
    if (assetPath) {
      parts.push(`![${type} page ${page}](${assetPath})`);
    }
    if (content) {
      parts.push(content);
    }
    return parts.join('\n');
  }

  if (type === 'table_caption' || type === 'image_caption') {
    const refLine = formatRefLine(page, type, bbox, assetPath);
    if (!content) return refLine;
    return `${refLine}\n${content}`;
  }

  if (!content) return formatRefLine(page, type, bbox, assetPath);
  return content;
}

function formatMarkdown(markdown, assetMap) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const output = [];
  const tagLineRegex = /^<\|ref\|>(.*?)<\|\/ref\|><\|det\|>\[\[(.*?)\]\]<\|\/det\|>\s*$/;
  const pageHeaderRegex = /^--- Page (\d+) of \d+ ---$/;
  let index = 0;
  let currentPage = 1;

  while (index < lines.length) {
    const line = lines[index];
    const pageMatch = line.match(pageHeaderRegex);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      output.push(line);
      index += 1;
      continue;
    }

    const tagMatch = line.match(tagLineRegex);
    if (!tagMatch) {
      output.push(line);
      index += 1;
      continue;
    }

    const type = (tagMatch[1] || 'default').trim() || 'default';
    const bbox = tagMatch[2]
      .split(',')
      .map(part => parseInt(part.trim(), 10))
      .filter(value => !Number.isNaN(value));
    index += 1;

    const contentLines = [];
    while (index < lines.length) {
      const nextLine = lines[index];
      if (tagLineRegex.test(nextLine) || pageHeaderRegex.test(nextLine)) break;
      contentLines.push(nextLine);
      index += 1;
    }

    const content = contentLines.join('\n').trim();
    output.push(formatBlock({ page: currentPage, type, bbox, content }, assetMap));
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' })); // added for json payload

app.post('/api/save', async (req, res) => {
  try {
    const { filename, markdown, annotations, detectionCrops } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename missing' });

    const outDir = path.join(__dirname, 'output');
    ensureDir(outDir);

    const base = path.parse(filename).name;
    const baseDir = path.join(outDir, base);
    ensureDir(baseDir);

    const mdPath = path.join(baseDir, `${base}.md`);
    if (annotations && Object.keys(annotations).length > 0) {
      const annotationDir = path.join(baseDir, 'assets', 'annotations');
      ensureDir(annotationDir);
      for (const [page, dataUrl] of Object.entries(annotations)) {
        if (!dataUrl) continue;
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const pageLabel = String(page).padStart(3, '0');
        fs.writeFileSync(path.join(annotationDir, `page_${pageLabel}.png`), base64Data, 'base64');
      }
    }

    const assetMap = new Map();
    if (Array.isArray(detectionCrops) && detectionCrops.length > 0) {
      const pageTypeCounts = new Map();
      for (const det of detectionCrops) {
        const page = String(det.page);
        const bbox = Array.isArray(det.bbox) ? det.bbox.map(n => parseInt(n, 10)) : [];
        if (bbox.length !== 4) continue;
        const rawType = (det.type || 'default').toString().trim() || 'default';
        const type = sanitizeSegment(rawType);
        const dataUrl = det.imageDataUrl;
        if (!dataUrl) continue;
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");

        const pageNumber = parseInt(page, 10);
        const pageLabel = String(Number.isNaN(pageNumber) ? page : pageNumber).padStart(3, '0');
        const pageDir = path.join(baseDir, 'assets', `page_${pageLabel}`);
        ensureDir(pageDir);

        const countKey = `${pageLabel}:${type}`;
        const nextCount = (pageTypeCounts.get(countKey) || 0) + 1;
        pageTypeCounts.set(countKey, nextCount);
        const fileLabel = String(nextCount).padStart(3, '0');
        const outName = `${type}_${fileLabel}.png`;
        const outPath = path.join(pageDir, outName);
        const relPath = `assets/page_${pageLabel}/${outName}`;
        fs.writeFileSync(outPath, base64Data, 'base64');
        assetMap.set(detectionKey(page, rawType, bbox), relPath);
      }
    }

    const markdownOut = formatMarkdown(markdown, assetMap);
    fs.writeFileSync(mdPath, markdownOut, 'utf8');
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
