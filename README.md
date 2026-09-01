# Extract-O-Matic — GOAT reset

This build intentionally removes the OCR / inventory / fragment-reference / structure / encode / QC pipeline.

The architecture is now:

```
PDF -> render selected pages to images --\
                                       -> GPT multimodal reconstruction -> Plain Text + Rendered HTML + HTML Code
IMAGE --------------------------------/
```

The rendered page image is the model input and source of truth.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Add `OPENAI_API_KEY`.
3. `npm install`
4. `node local-server.mjs`
5. Open `http://localhost:3000`

Optional env vars:

- `OPENAI_VISION_MODEL=gpt-5.6-sol`
- `OPENAI_API_MODE=chat_completions` or `responses`
- `OPENAI_REASONING_EFFORT=medium`

PDFium remains only to render PDF pages into PNG images. Direct PNG/JPG/WebP uploads bypass PDFium.
