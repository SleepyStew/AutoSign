(function initPopup() {
    "use strict";

    const api = typeof browser !== "undefined" ? browser : chrome;
    const promiseApi = typeof browser !== "undefined";
    const SIGNATURE_KEY = "autosign.signature";
    const SETTINGS_KEY = "autosign.settings";
    const PLAYBACK_MS = 500;
    const defaultSettings = {
        padding: 0.08
    };

    const previewCanvas = document.getElementById("previewCanvas");
    const editorButton = document.getElementById("editorButton");
    const signPageButton = document.getElementById("signPageButton");
    const statusText = document.getElementById("statusText");
    const paddingInput = document.getElementById("paddingInput");
    const ctx = previewCanvas.getContext("2d");

    let dpr = 1;
    let savedSignature = null;
    let previewSignature = null;
    let previewImage = null;
    let settings = {...defaultSettings};

    function storageGet(keys) {
        if (promiseApi) return api.storage.local.get(keys);
        return new Promise((resolve) => api.storage.local.get(keys, resolve));
    }

    function storageSet(values) {
        if (promiseApi) return api.storage.local.set(values);
        return new Promise((resolve) => api.storage.local.set(values, resolve));
    }

    function tabsQuery(query) {
        if (promiseApi) return api.tabs.query(query);
        return new Promise((resolve) => api.tabs.query(query, resolve));
    }

    function tabsCreate(createProperties) {
        if (promiseApi) return api.tabs.create(createProperties);
        return new Promise((resolve) => api.tabs.create(createProperties, resolve));
    }

    function tabsSendMessage(tabId, message) {
        if (promiseApi) return api.tabs.sendMessage(tabId, message);
        return new Promise((resolve, reject) => {
            api.tabs.sendMessage(tabId, message, (response) => {
                const error = api.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    function syncSettingsFromControls() {
        settings = {
            padding: Number(paddingInput.value) / 100
        };
    }

    async function persistSettings() {
        syncSettingsFromControls();
        await storageSet({[SETTINGS_KEY]: settings});
    }

    function resizePreview() {
        const rect = previewCanvas.getBoundingClientRect();
        dpr = Math.max(1, window.devicePixelRatio || 1);
        previewCanvas.width = Math.round(rect.width * dpr);
        previewCanvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        redrawPreview();
    }

    function clearCanvas() {
        const rect = previewCanvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
    }

    function redrawPreview() {
        clearCanvas();
        if (previewSignature?.strokes?.length) {
            drawSignaturePreviewStrokes();
        } else if (previewSignature && previewImage) {
            drawSignaturePreviewFallbackImage();
        }
    }

    function previewFit() {
        syncSettingsFromControls();
        const rect = previewCanvas.getBoundingClientRect();
        return AutoSignEngine.fitSignature(previewSignature, {
            left: 0,
            top: 0,
            width: rect.width,
            height: rect.height
        }, {padding: settings.padding});
    }

    function drawSignaturePreviewStrokes() {
        if (!previewSignature?.strokes?.length) return;
        AutoSignEngine.drawSignatureStrokes(ctx, previewSignature, previewFit());
    }

    function drawSignaturePreviewFallbackImage() {
        if (!previewSignature || !previewImage) return;
        const fit = previewFit();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(previewImage, fit.left, fit.top, fit.width, fit.height);
    }

    async function renderSignaturePreview(signature) {
        previewSignature = signature || null;
        previewImage = null;
        clearCanvas();

        if (signature?.strokes?.length) {
            redrawPreview();
            return;
        }

        if (!signature?.imageDataUrl) return;

        try {
            const image = await AutoSignEngine.loadImage(signature.imageDataUrl);
            if (previewSignature !== signature) return;
            previewImage = image;
            redrawPreview();
        } catch (error) {
            setStatus(error.message);
        }
    }

    async function openEditor() {
        await tabsCreate({url: api.runtime.getURL("editor/editor.html")});
        window.close();
    }

    async function signCurrentPage() {
        if (!savedSignature) {
            setStatus("Create a signature first");
            return;
        }

        syncSettingsFromControls();
        await persistSettings();
        const [tab] = await tabsQuery({active: true, currentWindow: true});
        if (!tab?.id) {
            setStatus("No active tab");
            return;
        }

        try {
            await tabsSendMessage(tab.id, {
                type: "autosign:beginPick",
                signature: savedSignature,
                settings: {
                    ...settings,
                    playbackMs: PLAYBACK_MS
                }
            });
            setStatus("Click a signature box");
            window.setTimeout(() => window.close(), 360);
        } catch (error) {
            setStatus("Refresh the page");
        }
    }

    async function loadState() {
        const stored = await storageGet([SIGNATURE_KEY, SETTINGS_KEY]);
        savedSignature = stored[SIGNATURE_KEY] || null;
        settings = {
            ...defaultSettings,
            padding: stored[SETTINGS_KEY]?.padding ?? defaultSettings.padding
        };

        paddingInput.value = Math.round(settings.padding * 100);
        signPageButton.disabled = !savedSignature;
        editorButton.textContent = savedSignature ? "Edit Signature" : "Create Signature";

        if (savedSignature) {
            setStatus(`${savedSignature.stats.strokes} strokes ready`);
            await renderSignaturePreview(savedSignature);
        } else {
            setStatus("Create a signature");
        }
    }

    editorButton.addEventListener("click", () => openEditor().catch((error) => setStatus(error.message)));
    signPageButton.addEventListener("click", () => signCurrentPage().catch((error) => setStatus(error.message)));
    paddingInput.addEventListener("input", () => {
        redrawPreview();
        persistSettings().catch(() => {
        });
    });
    window.addEventListener("resize", resizePreview);

    resizePreview();
    loadState().catch((error) => setStatus(error.message));
})();
