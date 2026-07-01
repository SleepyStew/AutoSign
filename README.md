# AutoSign

AutoSign is a browser extension for saving one handwritten signature locally and placing it into browser-based signature fields whenever you choose, eliminating the need for a messy manual signature entry every time.

It is designed for convenience on document signing pages. It is **not** a digital certificate system, an identity verification product, or legal advice.

## Features

- Draw and edit a saved signature in a full-page editor.
- Trace over an optional reference image while drawing. Reference images are temporary underlays and are not saved.
- Adjust stroke thickness, smoothing, reference opacity, and field padding.
- Click the extension, choose **Sign page**, then click the target signature field.
- Stamp saved signatures directly into canvas fields for clean rendering.
- Replay strokes into non-canvas fields when the page accepts synthetic pointer or mouse events.
- Store the signature and settings only in browser extension local storage.

## Permissions

AutoSign keeps the manifest intentionally small:

- `storage`: saves the signature and editor settings locally in the browser.
- `<all_urls>` host access: lets the content script appear on document pages so you can click a signature field and place the saved signature.

The extension does not request the `tabs` permission, does not call external services, and does not collect analytics.

## Use

1. Open the AutoSign popup.
2. Click **Create Signature** or **Edit Signature**.
3. Draw or trace your signature, then save.
4. Open a document signing page.
5. Click AutoSign, then **Sign page**.
6. Click the signature field or canvas on the page.

## Packaging

The extension has no build step. The files in `manifest.json` are the live extension files.

Recommended checks before submitting:

```sh
npx --yes web-ext lint --source-dir .
npx --yes web-ext build --source-dir . --overwrite-dest
```

`web-ext-config.mjs` excludes repository metadata and store-support documents from packaged extension builds.

## Limitations

- Some websites reject synthetic input events by checking `event.isTrusted`; browser extensions cannot bypass that security boundary.
- Canvas fields work best because AutoSign can draw the saved image directly.
- Non-canvas fields depend on the page accepting replayed pointer or mouse input.
- The site you sign on may process anything written into its own page. Review the site's terms and privacy policy before signing documents.