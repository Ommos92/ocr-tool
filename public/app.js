(() => {
  // ── PDF.js setup ──────────────────────────────────────────────────────────
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ── Elements ──────────────────────────────────────────────────────────────
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const imageCanvas = document.getElementById('imageCanvas');
  const annotCanvas = document.getElementById('annotationCanvas');
  const highlightCanvas = document.getElementById('highlightCanvas');
  const imgCtx = imageCanvas.getContext('2d');
  const annotCtx = annotCanvas.getContext('2d');
  const highlightCtx = highlightCanvas.getContext('2d');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const customPrompt = document.getElementById('customPrompt');
  const resultArea = document.getElementById('resultArea');
  const copyBtn = document.getElementById('copyBtn');
  const saveBtn = document.getElementById('saveBtn');
  const clearResultBtn = document.getElementById('clearResultBtn');
  const runBtn = document.getElementById('runBtn');
  const runAllBtn = document.getElementById('runAllBtn');
  const statusMsg = document.getElementById('statusMsg');
  const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
  const newFileBtn = document.getElementById('newFileBtn');
  const pageNav = document.getElementById('pageNav');
  const pageInfo = document.getElementById('pageInfo');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');

  // ── State ─────────────────────────────────────────────────────────────────
  let uploadedFile = null;
  let activePreset = 'Free OCR.';
  let activeTool = 'pen';
  let isDrawing = false;
  let startX = 0, startY = 0;
  let annotSnapshot = null; // ImageData snapshot for rect preview

  // PDF state
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 1;
  let pageAnnotationsData = {};
  let pageOCRResults = {};

  // ── File Upload (image or PDF) ────────────────────────────────────────────
  dropZone.addEventListener('click', () => fileInput.click());

  if (newFileBtn) {
    newFileBtn.addEventListener('click', () => fileInput.click());
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  function loadFile(file) {
    resultArea.value = '';
    setStatus('', '');
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (file.type === 'application/pdf') {
      loadPDF(file);
    } else if (file.type.startsWith('image/')) {
      pdfDoc = null;
      pageAnnotationsData = {};
      pageOCRResults = {};
      pageNav.classList.add('hidden');
      runAllBtn.classList.add('hidden');
      loadImage(file);
    }
  }

  function loadImage(file) {
    uploadedFile = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const wrapper = document.getElementById('canvasWrapper');
      const maxW = wrapper.clientWidth;
      const maxH = wrapper.clientHeight;

      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      imageCanvas.width = w;
      imageCanvas.height = h;
      annotCanvas.width = w;
      annotCanvas.height = h;
      highlightCanvas.width = w;
      highlightCanvas.height = h;

      imgCtx.drawImage(img, 0, 0, w, h);
      annotCtx.clearRect(0, 0, w, h);
      highlightCtx.clearRect(0, 0, w, h);

      dropZone.classList.add('hidden');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function loadPDF(file) {
    uploadedFile = file; // keep reference so runOCR guard passes
    setStatus('Loading PDF...', 'running');
    try {
      const arrayBuffer = await file.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      totalPages = pdfDoc.numPages;
      currentPage = 0; // Temporarily 0 so renderPage doesn't save empty canvas
      pageAnnotationsData = {};
      pageOCRResults = {};
      pageNav.classList.remove('hidden');
      runAllBtn.classList.remove('hidden');
      await renderPage(1);
      setStatus('', '');
    } catch (err) {
      setStatus(`PDF error: ${err.message}`, 'error');
    }
  }

  async function renderPage(pageNum) {
    if (pdfDoc && currentPage > 0 && annotCanvas.width > 0) {
      pageAnnotationsData[currentPage] = annotCanvas.toDataURL();
    }
    const page = await pdfDoc.getPage(pageNum);
    const wrapper = document.getElementById('canvasWrapper');
    const maxW = wrapper.clientWidth;
    const maxH = wrapper.clientHeight;

    const viewport1 = page.getViewport({ scale: 1 });
    const scale = Math.min(maxW / viewport1.width, maxH / viewport1.height);
    const viewport = page.getViewport({ scale });

    imageCanvas.width = Math.round(viewport.width);
    imageCanvas.height = Math.round(viewport.height);
    annotCanvas.width = imageCanvas.width;
    annotCanvas.height = imageCanvas.height;
    highlightCanvas.width = imageCanvas.width;
    highlightCanvas.height = imageCanvas.height;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (pageAnnotationsData[pageNum]) {
      const img = new Image();
      img.onload = () => annotCtx.drawImage(img, 0, 0);
      img.src = pageAnnotationsData[pageNum];
    }

    await page.render({ canvasContext: imgCtx, viewport }).promise;

    currentPage = pageNum;
    updatePageNav();
    dropZone.classList.add('hidden');

    if (pageOCRResults[pageNum]) {
      drawHighlights(pageOCRResults[pageNum]); // redraw previous highlights if any
    }
  }

  function updatePageNav() {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
  }

  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) renderPage(currentPage - 1);
  });

  nextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) renderPage(currentPage + 1);
  });

  // ── Annotation Tools ──────────────────────────────────────────────────────
  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'clear') {
        annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
        return;
      }
      activeTool = tool;
      toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  function getCanvasPos(e) {
    const rect = annotCanvas.getBoundingClientRect();
    const scaleX = annotCanvas.width / rect.width;
    const scaleY = annotCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function setupAnnotCtx() {
    annotCtx.strokeStyle = 'rgba(255, 80, 0, 0.85)';
    annotCtx.lineWidth = 2.5;
    annotCtx.lineCap = 'round';
    annotCtx.lineJoin = 'round';
    annotCtx.fillStyle = 'rgba(255, 80, 0, 0.85)';
    annotCtx.font = '16px sans-serif';
  }

  annotCanvas.addEventListener('mousedown', (e) => {
    if (!uploadedFile) return;
    isDrawing = true;
    const { x, y } = getCanvasPos(e);
    startX = x;
    startY = y;
    setupAnnotCtx();

    if (activeTool === 'pen') {
      annotCtx.beginPath();
      annotCtx.moveTo(x, y);
    } else if (activeTool === 'rect') {
      annotSnapshot = annotCtx.getImageData(0, 0, annotCanvas.width, annotCanvas.height);
    } else if (activeTool === 'text') {
      isDrawing = false;
      const label = prompt('Enter text to add:');
      if (label) {
        setupAnnotCtx();
        annotCtx.fillText(label, x, y);
      }
    }
  });

  annotCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const { x, y } = getCanvasPos(e);

    if (activeTool === 'pen') {
      annotCtx.lineTo(x, y);
      annotCtx.stroke();
    } else if (activeTool === 'rect') {
      // Restore snapshot and draw preview rect
      annotCtx.putImageData(annotSnapshot, 0, 0);
      setupAnnotCtx();
      annotCtx.strokeRect(startX, startY, x - startX, y - startY);
    }
  });

  annotCanvas.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;

    if (activeTool === 'pen') {
      annotCtx.closePath();
    } else if (activeTool === 'rect') {
      const { x, y } = getCanvasPos(e);
      annotCtx.putImageData(annotSnapshot, 0, 0);
      setupAnnotCtx();
      annotCtx.strokeRect(startX, startY, x - startX, y - startY);
      annotSnapshot = null;
    }
  });

  annotCanvas.addEventListener('mouseleave', () => {
    if (isDrawing && activeTool === 'pen') {
      isDrawing = false;
      annotCtx.closePath();
    }
  });

  // ── Prompt Selection ──────────────────────────────────────────────────────
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activePreset = btn.dataset.prompt;
      presetBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      customPrompt.value = '';
    });
  });

  customPrompt.addEventListener('input', () => {
    if (customPrompt.value.trim()) {
      presetBtns.forEach((b) => b.classList.remove('active'));
    } else {
      // Re-highlight previously selected preset
      presetBtns.forEach((b) => {
        if (b.dataset.prompt === activePreset) b.classList.add('active');
      });
    }
  });

  function getPrompt() {
    const custom = customPrompt.value.trim();
    return custom || activePreset;
  }

  // ── OCR Submission ────────────────────────────────────────────────────────
  runBtn.addEventListener('click', runOCR);
  runAllBtn.addEventListener('click', runAllPages);

  function getMergedBlob() {
    return new Promise((resolve) => {
      const merged = document.createElement('canvas');
      merged.width = imageCanvas.width;
      merged.height = imageCanvas.height;
      const mCtx = merged.getContext('2d');
      mCtx.drawImage(imageCanvas, 0, 0);
      mCtx.drawImage(annotCanvas, 0, 0);
      merged.toBlob(resolve, 'image/png');
    });
  }

  async function submitOCR(blob, prompt, append = false, targetPage = null) {
    const formData = new FormData();
    formData.append('image', blob, 'image.png');
    formData.append('prompt', prompt);

    if (!append) {
      resultArea.value = '';
      highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
    }
    if (targetPage !== null && !append) {
      pageOCRResults[targetPage] = '';
    } // Need to reset targetPage if running standalone on single page

    const res = await fetch('/api/ocr', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const { token, error } = JSON.parse(payload);
          if (error) throw new Error(error);
          if (token) {
            resultArea.value += token;
            resultArea.scrollTop = resultArea.scrollHeight;

            if (targetPage !== null) {
              pageOCRResults[targetPage] = (pageOCRResults[targetPage] || '') + token;
              if (currentPage === targetPage) drawHighlights(pageOCRResults[targetPage]);
            } else {
              drawHighlights(resultArea.value);
            }
          }
        } catch {
          // ignore parse errors on individual chunks
        }
      }
    }
  }

  function setRunning(busy) {
    runBtn.disabled = busy;
    runAllBtn.disabled = busy;
  }

  async function runOCR() {
    if (!uploadedFile) {
      setStatus('Please upload an image or PDF first.', 'error');
      return;
    }
    const prompt = getPrompt();
    if (!prompt) {
      setStatus('Please select or enter a prompt.', 'error');
      return;
    }

    const blob = await getMergedBlob();
    if (!blob) { setStatus('Failed to export image.', 'error'); return; }

    setRunning(true);
    setStatus('Running...', 'running');
    try {
      await submitOCR(blob, prompt, false, pdfDoc ? currentPage : null);
      setStatus('Done.', 'done');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  async function runAllPages() {
    if (!pdfDoc) return;
    const prompt = getPrompt();
    if (!prompt) {
      setStatus('Please select or enter a prompt.', 'error');
      return;
    }

    setRunning(true);
    resultArea.value = '';

    try {
      for (let i = 1; i <= totalPages; i++) {
        setStatus(`Processing page ${i} of ${totalPages}...`, 'running');
        await renderPage(i);

        resultArea.value += `\n--- Page ${i} of ${totalPages} ---\n`;
        resultArea.scrollTop = resultArea.scrollHeight;

        const blob = await getMergedBlob();
        if (!blob) throw new Error(`Failed to export page ${i}`);

        // Start fresh for this page's result accumulation since runAll appends to text area
        pageOCRResults[i] = '';
        await submitOCR(blob, prompt, true, i);

        resultArea.value += '\n';
      }
      setStatus(`Done — ${totalPages} pages processed.`, 'done');
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  // ── Copy / Clear ──────────────────────────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    if (!resultArea.value) return;
    try {
      await navigator.clipboard.writeText(resultArea.value);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch {
      setStatus('Clipboard access denied.', 'error');
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!resultArea.value) return;
    setStatus('Saving...', 'running');
    try {
      const payload = {
        filename: uploadedFile ? uploadedFile.name : 'ocr_result',
        markdown: resultArea.value,
        annotations: pageAnnotationsData // Send base64 data URLs for annotation canvases locally
      };

      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setStatus(`Saved to ${data.path}`, 'done');
      saveBtn.textContent = 'Saved!';
      setTimeout(() => (saveBtn.textContent = 'Save'), 2000);
    } catch (err) {
      setStatus(`Save errored: ${err.message}`, 'error');
    }
  });

  clearResultBtn.addEventListener('click', () => {
    resultArea.value = '';
    setStatus('', '');
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
  }

  function drawHighlights(text) {
    // Clear previous highlights
    highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    highlightCtx.lineWidth = 1.5;

    // Optional ref tag followed by det tag
    const regex = /(?:<\|ref\|>(.*?)<\|\/ref\|>\s*)?<\|det\|>\[\[(.*?)\]\]<\|\/det\|>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const type = (match[1] || 'default').trim();
      const coordsStr = match[2];
      const coords = coordsStr.split(',').map(n => parseInt(n.trim(), 10));

      if (coords.length === 4) {
        let strokeStyle, fillStyle;
        if (type === 'table') {
          strokeStyle = 'rgba(0, 200, 255, 0.8)'; // light blue
          fillStyle = 'rgba(0, 200, 255, 0.2)';
        } else if (type === 'image' || type === 'figure') {
          strokeStyle = 'rgba(255, 100, 200, 0.8)'; // pink
          fillStyle = 'rgba(255, 100, 200, 0.2)';
        } else if (type === 'interline_equation' || type === 'equation') {
          strokeStyle = 'rgba(100, 255, 100, 0.8)'; // green
          fillStyle = 'rgba(100, 255, 100, 0.2)';
        } else if (type === 'title') {
          strokeStyle = 'rgba(255, 200, 0, 0.8)'; // orange-yellow
          fillStyle = 'rgba(255, 200, 0, 0.2)';
        } else {
          // 'text' or default fallback
          strokeStyle = 'rgba(255, 100, 0, 0.8)'; // original orange
          fillStyle = 'rgba(255, 255, 0, 0.2)'; // original yellow
        }

        highlightCtx.strokeStyle = strokeStyle;
        highlightCtx.fillStyle = fillStyle;

        // DeepSeek typically outputs normalized coordinates in [0, 1000] range
        const [xmin, ymin, xmax, ymax] = coords;
        const wRatio = highlightCanvas.width / 1000;
        const hRatio = highlightCanvas.height / 1000;

        const x = xmin * wRatio;
        const y = ymin * hRatio;
        const width = (xmax - xmin) * wRatio;
        const height = (ymax - ymin) * hRatio;

        // Draw the rect on the canvas over the text/figure
        highlightCtx.fillRect(x, y, width, height);
        highlightCtx.strokeRect(x, y, width, height);
      }
    }
  }
})();
