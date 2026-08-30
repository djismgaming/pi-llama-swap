# pi-llama-swap

Pi extension that registers your local **llama-swap** instance
(`http://localhost:9090/v1`) as a model provider.

- **OpenAI-compatible** — all requests stream through pi's built-in
  `openai-completions` implementation.
- **Auto-refreshing model list** — fetches `/v1/models` when pi starts, so any
  models loaded on the server are available in `/model` without manual config.
- **No API key** — the local endpoint is open; nothing to authenticate.
- **Capability-aware** — image generation models (FLUX.2 klein, KREA 2, ideogram 4)
  are filtered out so the picker only lists chat-capable text/vision models.
  Each model entry carries its context window and input modalities.

## Setup

1. Make sure the llama-swap endpoint is running at `http://localhost:9090`:

   ```bash
   # Optional — point at a different server
   export LLAMA_SWAP_BASE_URL=http://localhost:9090/v1
   # Optional — fallback context window (tokens) when a model doesn't report one
   export LLAMA_SWAP_CONTEXT=128000
   ```

2. Install the extension from this repo:

   ```bash
   pi install /path/to/pi-llama-swap
   # or from GitHub once published:
   pi install github.com/yourname/pi-llama-swap
   ```

3. Restart pi (or run `/reload`). The provider appears as **llama-swap (local)**
   and the model picker (`/model` or Ctrl+L) lists whatever the server reports
   in `/v1/models` at startup.

## Commands

| Command | Description |
|---------|-------------|
| `/llama-swap-models` | Lists all chat-capable models with their context window and input modalities. |

## How it works

The extension factory is `async`: pi waits for it before continuing startup, so
the model list is fetched fresh on every start. Model entries are mapped with:

- **context window** — from `context_length` returned by the server, falling
  back to `LLAMA_SWAP_CONTEXT` (default `128000`).
- **input** — `["text"]` for text-only models, `["text", "image"]` for
  vision-capable models, derived from each model's `architecture.input_modalities`.
- **max tokens** — `16384` (safe default for local GGUF/Qwen servers).
- **cost** — all zero (local inference, no billing).

If the fetch fails (server down), pi still starts; the provider is registered
with no models and an error is logged. Start the server and run `/reload`.

## Typecheck

```bash
npm install
npm run typecheck
```
