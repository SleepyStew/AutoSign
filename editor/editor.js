(function initEditor() {
    "use strict";

    const api = typeof browser !== "undefined" ? browser : chrome;
    const promiseApi = typeof browser !== "undefined";
    const SIGNATURE_KEY = "autosign.signature";
    const EDITOR_SETTINGS_KEY = "autosign.editorSettings";

    const canvas = document.getElementById("signatureCanvas");
    const ctx = canvas.getContext("2d");
    const statusText = document.getElementById("statusText");
    const saveButton = document.getElementById("saveButton");
    const doneButton = document.getElementById("doneButton");
    const referenceButton = document.getElementById("referenceButton");
    const undoButton = document.getElementById("undoButton");
    const clearButton = document.getElementById("clearButton");
    const referenceInput = document.getElementById("referenceInput");
    const thicknessInput = document.getElementById("thicknessInput");
    const smoothnessInput = document.getElementById("smoothnessInput");
    const referenceOpacityInput = document.getElementById("referenceOpacityInput");

    let dpr = 1;
    let rawStrokes = [];
    let activeStroke = null;
    let referenceImage = null;
    let lastSize = {width: 1, height: 1};

    function storageGet(keys) {
        if (promiseApi) return api.storage.local.get(keys);
        return new Promise((resolve) => api.storage.local.get(keys, resolve));
    }

    function storageSet(values) {
        if (promiseApi) return api.storage.local.set(values);
        return new Promise((resolve) => api.storage.local.set(values, resolve));
    }

    function tabsGetCurrent() {
        if (!api.tabs?.getCurrent) return Promise.resolve(null);
        if (promiseApi) return api.tabs.getCurrent();
        return new Promise((resolve) => api.tabs.getCurrent(resolve));
    }

    function tabsRemove(tabId) {
        if (!api.tabs?.remove || tabId === undefined) return Promise.resolve();
        if (promiseApi) return api.tabs.remove(tabId);
        return new Promise((resolve) => api.tabs.remove(tabId, resolve));
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    function getRect() {
        return canvas.getBoundingClientRect();
    }

    function currentSettings() {
        return {
            thickness: Number(thicknessInput.value),
            smoothness: Number(smoothnessInput.value),
            referenceOpacity: Number(referenceOpacityInput.value) / 100
        };
    }

    function rescaleStrokes(from, to) {
        if (!from.width || !from.height || (from.width === to.width && from.height === to.height)) return;

        function scaleStroke(stroke) {
            for (const point of stroke) {
                point.x = (point.x / from.width) * to.width;
                point.y = (point.y / from.height) * to.height;
            }
        }

        for (const stroke of rawStrokes) {
            scaleStroke(stroke);
        }
        if (activeStroke) {
            scaleStroke(activeStroke);
        }
    }

    function resizeCanvas() {
        const rect = getRect();
        const nextSize = {
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height)
        };

        rescaleStrokes(lastSize, nextSize);
        lastSize = nextSize;
        dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(nextSize.width * dpr);
        canvas.height = Math.round(nextSize.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        render();
    }

    function smoothPreviewPoints(points, passes) {
        if (points.length <= 2 || passes <= 0) return points;
        let current = points;

        for (let pass = 0; pass < passes; pass += 1) {
            const smoothed = [current[0]];
            for (let i = 1; i < current.length - 1; i += 1) {
                smoothed.push({
                    x: (current[i - 1].x * 0.22) + (current[i].x * 0.56) + (current[i + 1].x * 0.22),
                    y: (current[i - 1].y * 0.22) + (current[i].y * 0.56) + (current[i + 1].y * 0.22)
                });
            }
            smoothed.push(current[current.length - 1]);
            current = smoothed;
        }

        return current;
    }

    function clearCanvas() {
        const rect = getRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
    }

    function drawReference() {
        if (!referenceImage) return;
        const settings = currentSettings();
        const rect = getRect();
        const signatureLike = {
            aspectRatio: referenceImage.naturalWidth / Math.max(1, referenceImage.naturalHeight)
        };
        const fit = AutoSignEngine.fitSignature(signatureLike, {
            left: 0,
            top: 0,
            width: rect.width,
            height: rect.height
        }, {padding: 0.05});

        ctx.save();
        ctx.globalAlpha = settings.referenceOpacity;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(referenceImage, fit.left, fit.top, fit.width, fit.height);
        ctx.restore();
    }

    function drawStroke(stroke) {
        if (stroke.length < 2) return;
        const settings = currentSettings();
        const previewStroke = smoothPreviewPoints(stroke, Math.round(settings.smoothness / 22));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = settings.thickness;
        ctx.strokeStyle = "#171719";
        ctx.beginPath();
        ctx.moveTo(previewStroke[0].x, previewStroke[0].y);

        for (let i = 1; i < previewStroke.length; i += 1) {
            const previous = previewStroke[i - 1];
            const point = previewStroke[i];
            ctx.quadraticCurveTo(previous.x, previous.y, (previous.x + point.x) / 2, (previous.y + point.y) / 2);
        }

        const last = previewStroke[previewStroke.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
    }

    function render() {
        clearCanvas();
        drawReference();
        for (const stroke of rawStrokes) {
            drawStroke(stroke);
        }
        if (activeStroke) {
            drawStroke(activeStroke);
        }
    }

    function pointFromEvent(event) {
        const rect = getRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            time: performance.now()
        };
    }

    function startDrawing(event) {
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        activeStroke = [pointFromEvent(event)];
        render();
    }

    function continueDrawing(event) {
        if (!activeStroke) return;
        event.preventDefault();
        const point = pointFromEvent(event);
        const previous = activeStroke[activeStroke.length - 1];
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.9) return;
        activeStroke.push(point);
        render();
    }

    function endDrawing(event) {
        if (!activeStroke) return;
        event.preventDefault();
        if (activeStroke.length >= 2) {
            rawStrokes.push(activeStroke);
            setStatus(`${rawStrokes.length} strokes`);
        }
        activeStroke = null;
        render();
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Could not read that image."));
            reader.readAsDataURL(file);
        });
    }

    async function loadReference(file) {
        if (!file) return;
        const referenceDataUrl = await readFileAsDataUrl(file);
        referenceImage = await AutoSignEngine.loadImage(referenceDataUrl);
        referenceButton.textContent = "Remove Reference";
        referenceButton.classList.remove("button-secondary");
        referenceButton.classList.add("button-ghost");
        setStatus("Reference loaded");
        render();
    }

    function removeReference() {
        referenceImage = null;
        referenceButton.textContent = "Add Reference Image";
        referenceButton.classList.remove("button-ghost");
        referenceButton.classList.add("button-secondary");
        setStatus("Reference removed");
        render();
    }

    async function saveSignature() {
        if (!rawStrokes.length) {
            setStatus("Draw first");
            return;
        }

        const rect = getRect();
        const settings = currentSettings();
        const signature = AutoSignEngine.signatureFromDrawnStrokes(rawStrokes, {
            cssWidth: rect.width,
            cssHeight: rect.height,
            dpr,
            lineWidth: settings.thickness,
            smoothness: settings.smoothness,
            outputScale: Math.max(4, Math.min(6, dpr * 2.5))
        });

        signature.editorSettings = {
            thickness: settings.thickness,
            smoothness: settings.smoothness
        };

        await storageSet({
            [SIGNATURE_KEY]: signature,
            [EDITOR_SETTINGS_KEY]: {
                thickness: settings.thickness,
                smoothness: settings.smoothness,
                referenceOpacity: settings.referenceOpacity
            }
        });

        setStatus(`${signature.stats.strokes} strokes saved`);
        await closeEditor();
    }

    function restoreSignatureToCanvas(signature) {
        if (!signature?.strokes?.length || signature.kind !== "drawn") return;
        const rect = getRect();
        const fit = AutoSignEngine.fitSignature(signature, {
            left: 0,
            top: 0,
            width: rect.width,
            height: rect.height
        }, {padding: 0.16});

        rawStrokes = signature.strokes.map((stroke) => stroke.map((point) => fit.point(point)));
        setStatus(`${rawStrokes.length} strokes loaded`);
    }

    async function loadInitialState() {
        const stored = await storageGet([SIGNATURE_KEY, EDITOR_SETTINGS_KEY]);
        const editorSettings = stored[EDITOR_SETTINGS_KEY] || stored[SIGNATURE_KEY]?.editorSettings || {};

        if (editorSettings.thickness !== undefined) {
            thicknessInput.value = editorSettings.thickness;
        }
        if (editorSettings.smoothness !== undefined) {
            smoothnessInput.value = editorSettings.smoothness;
        }
        if (editorSettings.referenceOpacity !== undefined) {
            referenceOpacityInput.value = Math.round(editorSettings.referenceOpacity * 100);
        }

        restoreSignatureToCanvas(stored[SIGNATURE_KEY]);
        render();
    }

    async function closeEditor() {
        const tab = await tabsGetCurrent();
        if (tab?.id !== undefined) {
            await tabsRemove(tab.id);
            return;
        }
        window.close();
    }

    canvas.addEventListener("pointerdown", startDrawing);
    canvas.addEventListener("pointermove", continueDrawing);
    canvas.addEventListener("pointerup", endDrawing);
    canvas.addEventListener("pointercancel", endDrawing);
    saveButton.addEventListener("click", () => saveSignature().catch((error) => setStatus(error.message)));
    doneButton.addEventListener("click", () => closeEditor().catch(() => window.close()));
    referenceButton.addEventListener("click", () => {
        if (referenceImage) {
            removeReference();
        } else {
            referenceInput.click();
        }
    });
    undoButton.addEventListener("click", () => {
        rawStrokes.pop();
        setStatus(rawStrokes.length ? `${rawStrokes.length} strokes` : "Ready");
        render();
    });
    clearButton.addEventListener("click", () => {
        rawStrokes = [];
        activeStroke = null;
        setStatus("Cleared");
        render();
    });
    referenceInput.addEventListener("change", (event) => {
        loadReference(event.target.files?.[0]).catch((error) => setStatus(error.message));
        referenceInput.value = "";
    });
    thicknessInput.addEventListener("input", render);
    smoothnessInput.addEventListener("input", render);
    referenceOpacityInput.addEventListener("input", render);
    window.addEventListener("resize", resizeCanvas);

    resizeCanvas();
    loadInitialState().catch((error) => setStatus(error.message));
})();
