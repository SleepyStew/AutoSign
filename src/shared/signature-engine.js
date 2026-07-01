(function attachAutoSignEngine(global) {
    "use strict";

    const ENGINE_VERSION = 1;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Could not load the signature image."));
            img.src = src;
        });
    }

    function makeCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
    }

    function sourceSize(signature) {
        const stats = signature?.stats || {};
        const outputScale = stats.outputScale || 4;

        return {
            width: stats.sourceWidth || (stats.width ? stats.width / outputScale : 0),
            height: stats.sourceHeight || (stats.height ? stats.height / outputScale : 0)
        };
    }

    function signatureLineWidth(signature, rect, options = {}) {
        const stats = signature?.stats || {};
        const source = sourceSize(signature);
        const baseThickness = Number(options.lineWidth ?? stats.thickness ?? 2.4);
        const fallbackScale = Math.min(rect.width, rect.height) / 120;
        const scale = source.width && source.height
            ? Math.min(rect.width / source.width, rect.height / source.height)
            : fallbackScale;
        const minLineWidth = options.minLineWidth ?? 1.1;
        const maxLineWidth = options.maxLineWidth ?? Math.max(4, Math.min(rect.width, rect.height) * 0.16);

        return clamp(baseThickness * scale, minLineWidth, maxLineWidth);
    }

    function drawSignatureStrokes(ctx, signature, rect, options = {}) {
        if (!signature?.strokes?.length) return false;

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = signatureLineWidth(signature, rect, options);
        ctx.strokeStyle = options.strokeStyle || "#171719";

        for (const stroke of signature.strokes) {
            if (stroke.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(rect.left + (stroke[0][0] * rect.width), rect.top + (stroke[0][1] * rect.height));

            for (let i = 1; i < stroke.length; i += 1) {
                const previous = stroke[i - 1];
                const point = stroke[i];
                const previousX = rect.left + (previous[0] * rect.width);
                const previousY = rect.top + (previous[1] * rect.height);
                const pointX = rect.left + (point[0] * rect.width);
                const pointY = rect.top + (point[1] * rect.height);
                ctx.quadraticCurveTo(previousX, previousY, (previousX + pointX) / 2, (previousY + pointY) / 2);
            }

            const last = stroke[stroke.length - 1];
            ctx.lineTo(rect.left + (last[0] * rect.width), rect.top + (last[1] * rect.height));
            ctx.stroke();
        }

        ctx.restore();
        return true;
    }

    function perpendicularDistance(point, start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx === 0 && dy === 0) {
            return Math.hypot(point.x - start.x, point.y - start.y);
        }

        const numerator = Math.abs((dy * point.x) - (dx * point.y) + (end.x * start.y) - (end.y * start.x));
        return numerator / Math.hypot(dx, dy);
    }

    function simplifyPoints(points, tolerance) {
        if (points.length <= 2) return points;

        let maxDistance = 0;
        let splitIndex = 0;
        const last = points.length - 1;

        for (let i = 1; i < last; i += 1) {
            const distance = perpendicularDistance(points[i], points[0], points[last]);
            if (distance > maxDistance) {
                maxDistance = distance;
                splitIndex = i;
            }
        }

        if (maxDistance <= tolerance) {
            return [points[0], points[last]];
        }

        const left = simplifyPoints(points.slice(0, splitIndex + 1), tolerance);
        const right = simplifyPoints(points.slice(splitIndex), tolerance);
        return left.slice(0, -1).concat(right);
    }

    function smoothPoints(points, passes) {
        if (points.length <= 2 || passes <= 0) return points;
        let current = points.map((point) => ({x: point.x, y: point.y, time: point.time}));

        for (let pass = 0; pass < passes; pass += 1) {
            const smoothed = [current[0]];
            for (let i = 1; i < current.length - 1; i += 1) {
                smoothed.push({
                    x: (current[i - 1].x * 0.22) + (current[i].x * 0.56) + (current[i + 1].x * 0.22),
                    y: (current[i - 1].y * 0.22) + (current[i].y * 0.56) + (current[i + 1].y * 0.22),
                    time: current[i].time
                });
            }
            smoothed.push(current[current.length - 1]);
            current = smoothed;
        }

        return current;
    }

    function strokeBounds(rawStrokes) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const stroke of rawStrokes) {
            for (const point of stroke) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }

        if (!Number.isFinite(minX)) return null;
        return {minX, minY, maxX, maxY};
    }

    function signatureFromDrawnStrokes(rawStrokes, options = {}) {
        const bounds = strokeBounds(rawStrokes);
        if (!bounds) {
            throw new Error("Draw a signature first.");
        }

        const cssWidth = options.cssWidth || options.sourceCanvas?.clientWidth || 1;
        const cssHeight = options.cssHeight || options.sourceCanvas?.clientHeight || 1;
        const padding = options.padding ?? 8;
        const minX = clamp(bounds.minX - padding, 0, cssWidth);
        const minY = clamp(bounds.minY - padding, 0, cssHeight);
        const maxX = clamp(bounds.maxX + padding, 0, cssWidth);
        const maxY = clamp(bounds.maxY + padding, 0, cssHeight);
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        const smoothness = clamp(Number(options.smoothness ?? 35), 0, 100);
        const smoothPasses = Math.round(smoothness / 22);
        const simplifyTolerance = 0.25 + ((smoothness / 100) * 2.25);

        const normalized = rawStrokes
            .map((stroke) => simplifyPoints(smoothPoints(stroke, smoothPasses), simplifyTolerance).map((point) => [
                clamp((point.x - minX) / width, 0, 1),
                clamp((point.y - minY) / height, 0, 1)
            ]))
            .filter((stroke) => stroke.length >= 2);

        const dpr = options.dpr || 1;
        const outputScale = options.outputScale || Math.max(3, Math.min(5, dpr * 2));
        const crop = makeCanvas(width * outputScale, height * outputScale);
        const ctx = crop.getContext("2d");
        const lineWidth = options.lineWidth || 2.4;

        ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = options.strokeStyle || "#171719";

        for (const stroke of normalized) {
            if (stroke.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(stroke[0][0] * width, stroke[0][1] * height);
            for (let i = 1; i < stroke.length; i += 1) {
                const previous = stroke[i - 1];
                const point = stroke[i];
                const previousX = previous[0] * width;
                const previousY = previous[1] * height;
                const pointX = point[0] * width;
                const pointY = point[1] * height;
                ctx.quadraticCurveTo(previousX, previousY, (previousX + pointX) / 2, (previousY + pointY) / 2);
            }
            const last = stroke[stroke.length - 1];
            ctx.lineTo(last[0] * width, last[1] * height);
            ctx.stroke();
        }

        return {
            version: ENGINE_VERSION,
            kind: "drawn",
            createdAt: new Date().toISOString(),
            aspectRatio: width / height,
            imageDataUrl: crop.toDataURL("image/png"),
            strokes: normalized,
            stats: {
                strokes: normalized.length,
                points: normalized.reduce((sum, stroke) => sum + stroke.length, 0),
                width: crop.width,
                height: crop.height,
                sourceWidth: width,
                sourceHeight: height,
                outputScale,
                smoothness,
                thickness: lineWidth
            }
        };
    }

    function fitSignature(signature, rect, options = {}) {
        const padding = options.padding ?? 0.08;
        const aspectRatio = signature.aspectRatio || 3;
        const innerWidth = Math.max(1, rect.width * (1 - (padding * 2)));
        const innerHeight = Math.max(1, rect.height * (1 - (padding * 2)));
        let width = innerWidth;
        let height = width / aspectRatio;

        if (height > innerHeight) {
            height = innerHeight;
            width = height * aspectRatio;
        }

        const left = rect.left + ((rect.width - width) / 2);
        const top = rect.top + ((rect.height - height) / 2);

        return {
            left,
            top,
            width,
            height,
            point(normalizedPoint) {
                return {
                    x: left + (normalizedPoint[0] * width),
                    y: top + (normalizedPoint[1] * height)
                };
            }
        };
    }

    global.AutoSignEngine = {
        signatureFromDrawnStrokes,
        fitSignature,
        drawSignatureStrokes,
        loadImage,
        version: ENGINE_VERSION
    };
})(globalThis);
