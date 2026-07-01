(function initAutoSignContent() {
    "use strict";

    if (globalThis.__autosignContentLoaded) return;
    globalThis.__autosignContentLoaded = true;

    const api = typeof browser !== "undefined" ? browser : chrome;
    const DEFAULT_PLAYBACK_MS = 500;
    const DEFAULT_STROKE_PAUSE_MS = 100;
    let activePicker = null;
    let toastTimer = 0;

    function showToast(message, tone = "normal") {
        const existing = document.getElementById("autosign-picker-toast");
        existing?.remove();
        window.clearTimeout(toastTimer);

        const toast = document.createElement("div");
        toast.id = "autosign-picker-toast";
        toast.dataset.tone = tone;
        toast.textContent = message;
        document.documentElement.append(toast);

        toastTimer = window.setTimeout(() => toast.remove(), tone === "error" ? 4200 : 2200);
    }

    function eventTargetFromPoint(x, y) {
        let target = document.elementFromPoint(x, y);

        while (target?.shadowRoot) {
            const shadowTarget = target.shadowRoot.elementFromPoint?.(x, y);
            if (!shadowTarget || shadowTarget === target) break;
            target = shadowTarget;
        }

        return target;
    }

    function chooseDrawableTarget(element) {
        if (!element || element === document.documentElement) return document.body;
        if (element instanceof HTMLCanvasElement) return element;

        const nearestCanvas = element.closest?.("canvas");
        if (nearestCanvas) return nearestCanvas;

        const childCanvas = element.querySelector?.("canvas");
        if (childCanvas) return childCanvas;

        const signatureHint = element.closest?.("[class*='sign' i], [id*='sign' i], [aria-label*='sign' i]");
        const hintedCanvas = signatureHint?.querySelector?.("canvas");
        if (hintedCanvas) return hintedCanvas;

        return element;
    }

    function elementLabel(element) {
        const tag = element instanceof HTMLCanvasElement ? "canvas" : element.tagName?.toLowerCase() || "element";
        const rect = element.getBoundingClientRect();
        const name = element.getAttribute?.("aria-label") || element.getAttribute?.("name") || element.id || element.className || "";
        const cleanName = typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 44) : "";
        const size = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
        return cleanName ? `${tag} - ${cleanName} - ${size}` : `${tag} - ${size}`;
    }

    function updateOutline(outline, target) {
        const rect = target.getBoundingClientRect();
        outline.style.left = `${Math.max(0, rect.left)}px`;
        outline.style.top = `${Math.max(0, rect.top)}px`;
        outline.style.width = `${Math.max(8, rect.width)}px`;
        outline.style.height = `${Math.max(8, rect.height)}px`;
        outline.dataset.label = elementLabel(target);
    }

    function keyboardCancelable(event) {
        if (event.key !== "Escape") return;
        activePicker?.cleanup();
        showToast("AutoSign canceled");
    }

    function startPicker(signature, settings) {
        activePicker?.cleanup();

        if (!signature?.strokes?.length) {
            showToast("Save a signature first", "error");
            return;
        }

        const outline = document.createElement("div");
        outline.id = "autosign-picker-outline";
        outline.dataset.label = "Pick a signature field";
        document.documentElement.append(outline);

        let currentTarget = null;
        let picked = false;

        function cleanup() {
            document.removeEventListener("pointermove", onMove, true);
            document.removeEventListener("pointerdown", onPress, true);
            document.removeEventListener("mousedown", onPress, true);
            document.removeEventListener("pointerup", blockPageEvent, true);
            document.removeEventListener("mouseup", blockPageEvent, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", keyboardCancelable, true);
            outline.remove();
            activePicker = null;
        }

        function targetFromEvent(event) {
            const element = eventTargetFromPoint(event.clientX, event.clientY);
            return chooseDrawableTarget(element);
        }

        function blockPageEvent(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }

        function armReleaseBlockers() {
            const events = ["mousedown", "pointerup", "mouseup", "click", "auxclick"];

            function releaseBlocker(event) {
                if (event.isTrusted) {
                    blockPageEvent(event);
                }
            }

            for (const eventName of events) {
                document.addEventListener(eventName, releaseBlocker, true);
            }

            window.setTimeout(() => {
                for (const eventName of events) {
                    document.removeEventListener(eventName, releaseBlocker, true);
                }
            }, 800);
        }

        function onMove(event) {
            const target = targetFromEvent(event);
            if (!target) return;
            currentTarget = target;
            updateOutline(outline, currentTarget);
        }

        function onPress(event) {
            blockPageEvent(event);
            if (picked) return;
            picked = true;
            const target = targetFromEvent(event) || currentTarget;
            if (target) updateOutline(outline, target);
            cleanup();
            armReleaseBlockers();

            if (!target) {
                showToast("No target found", "error");
                return;
            }

            showToast("Signing");
            writeSignature(target, signature, settings)
                .then(() => showToast("Signed"))
                .catch((error) => showToast(error.message, "error"));
        }

        function onClick(event) {
            blockPageEvent(event);
        }

        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerdown", onPress, true);
        document.addEventListener("mousedown", onPress, true);
        document.addEventListener("pointerup", blockPageEvent, true);
        document.addEventListener("mouseup", blockPageEvent, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", keyboardCancelable, true);

        activePicker = {cleanup};
        showToast("Click a signature field");
    }

    function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(resolve));
    }

    function delay(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function expandPoints(points, maxStep = 5) {
        if (points.length < 2) return points;
        const expanded = [points[0]];

        for (let i = 1; i < points.length; i += 1) {
            const previous = points[i - 1];
            const point = points[i];
            const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
            const steps = Math.max(1, Math.ceil(distance / maxStep));

            for (let step = 1; step <= steps; step += 1) {
                const t = step / steps;
                expanded.push({
                    x: previous.x + ((point.x - previous.x) * t),
                    y: previous.y + ((point.y - previous.y) * t)
                });
            }
        }

        return expanded;
    }

    function mouseTypeForPointer(type) {
        if (type === "pointerdown") return "mousedown";
        if (type === "pointerup" || type === "pointercancel") return "mouseup";
        return "mousemove";
    }

    function createMouseEvent(type, common, pressed) {
        const event = new MouseEvent(mouseTypeForPointer(type), common);

        try {
            Object.defineProperty(event, "which", {get: () => 1});
        } catch (error) {
            // Older signature pads rely on `which`; ignore if the browser will not allow overriding it.
        }

        try {
            Object.defineProperty(event, "buttons", {get: () => (pressed ? 1 : 0)});
        } catch (error) {
            // The constructor usually handles this, but the fallback above keeps old pads happier.
        }

        return event;
    }

    function dispatchPenEvent(target, type, point, pressed, mode) {
        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: point.x,
            clientY: point.y,
            screenX: window.screenX + point.x,
            screenY: window.screenY + point.y,
            button: 0,
            buttons: pressed ? 1 : 0
        };

        if (mode === "pointer" && typeof PointerEvent !== "undefined") {
            target.dispatchEvent(new PointerEvent(type, {
                ...common,
                pointerId: 8451,
                pointerType: "pen",
                isPrimary: true,
                pressure: pressed ? 0.58 : 0
            }));
            return;
        }

        target.dispatchEvent(createMouseEvent(type, common, pressed));
    }

    function dispatchFocusEvent(target, type, bubbles) {
        try {
            target.dispatchEvent(new FocusEvent(type, {
                bubbles,
                composed: true,
                relatedTarget: document.body
            }));
        } catch (error) {
            target.dispatchEvent(new Event(type, {bubbles, composed: true}));
        }
    }

    function completionTargets(target) {
        const targets = new Set([target]);
        const signatureContainer = target.closest?.("[class*='sign' i], [id*='sign' i], [aria-label*='sign' i]")
            || target.parentElement;
        const form = target.closest?.("form");

        if (signatureContainer) {
            targets.add(signatureContainer);
            for (const control of signatureContainer.querySelectorAll?.("input, textarea") || []) {
                targets.add(control);
            }
        }

        if (form) targets.add(form);
        return targets;
    }

    async function playStrokes(target, signature, fit, settings) {
        const fittedStrokes = signature.strokes
            .map((stroke) => stroke.map((point) => fit.point(point)))
            .map((stroke) => expandPoints(stroke))
            .filter((stroke) => stroke.length >= 2);

        const totalPoints = fittedStrokes.reduce((sum, stroke) => sum + stroke.length, 0);
        const targetFrames = Math.max(1, Math.round((settings.playbackMs || DEFAULT_PLAYBACK_MS) / 16));
        const pointsPerFrame = Math.max(1, Math.ceil(totalPoints / targetFrames));
        let emitted = 0;
        const mode = settings.eventMode || (target instanceof HTMLCanvasElement ? "mouse" : "pointer");

        target.focus?.({preventScroll: true});

        for (let strokeIndex = 0; strokeIndex < fittedStrokes.length; strokeIndex += 1) {
            const stroke = fittedStrokes[strokeIndex];

            if (strokeIndex > 0) {
                await delay(settings.strokePauseMs ?? DEFAULT_STROKE_PAUSE_MS);
                // Real pointers hover to the next start point before pressing again; some pads need that to avoid connector lines.
                dispatchPenEvent(target, "pointermove", stroke[0], false, mode);
                await nextFrame();
            }

            dispatchPenEvent(target, "pointerdown", stroke[0], true, mode);

            for (let i = 1; i < stroke.length; i += 1) {
                dispatchPenEvent(target, "pointermove", stroke[i], true, mode);
                emitted += 1;
                if (emitted % pointsPerFrame === 0) {
                    await nextFrame();
                }
            }

            dispatchPenEvent(target, "pointerup", stroke[stroke.length - 1], false, mode);
            if (strokeIndex === fittedStrokes.length - 1) {
                await nextFrame();
            }
        }
    }

    async function drawExactCanvas(canvas, signature, fit) {
        const rect = canvas.getBoundingClientRect();
        const drawX = ((fit.left - rect.left) / rect.width) * canvas.width;
        const drawY = ((fit.top - rect.top) / rect.height) * canvas.height;
        const drawWidth = (fit.width / rect.width) * canvas.width;
        const drawHeight = (fit.height / rect.height) * canvas.height;
        const ctx = canvas.getContext("2d");

        ctx.save();
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const didDrawStrokes = AutoSignEngine.drawSignatureStrokes(ctx, signature, {
            left: drawX,
            top: drawY,
            width: drawWidth,
            height: drawHeight
        });

        if (!didDrawStrokes && signature.imageDataUrl) {
            const image = await AutoSignEngine.loadImage(signature.imageDataUrl);
            ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        }

        ctx.restore();
    }

    function dispatchCompletionEvents(target) {
        dispatchFocusEvent(target, "focusout", true);
        dispatchFocusEvent(target, "blur", false);

        // Required-state listeners often live on wrappers or hidden inputs rather than the drawing surface itself.
        for (const eventTarget of completionTargets(target)) {
            eventTarget.dispatchEvent(new Event("input", {bubbles: true, composed: true}));
            eventTarget.dispatchEvent(new Event("change", {bubbles: true, composed: true}));
            eventTarget.dispatchEvent(new CustomEvent("autosign:complete", {
                bubbles: true,
                composed: true,
                detail: {source: "AutoSign"}
            }));
        }
    }

    async function writeSignature(target, signature, settings = {}) {
        const rect = target.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) {
            throw new Error("That target is too small.");
        }

        const fit = AutoSignEngine.fitSignature(signature, rect, {
            padding: settings.padding ?? 0.08
        });

        if (target instanceof HTMLCanvasElement) {
            await drawExactCanvas(target, signature, fit);
        } else {
            await playStrokes(target, signature, fit, settings);
        }

        dispatchCompletionEvents(target);
    }

    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== "autosign:beginPick") return false;
        startPicker(message.signature, message.settings || {});
        sendResponse?.({ok: true});
        return false;
    });
})();
