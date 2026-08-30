/**
 * llama-swap provider extension for pi.
 *
 * Registers the local llama-swap instance as a pi model provider and
 * auto-refreshes the available model list from the server's /v1/models
 * endpoint when pi starts. Because llama-swap speaks the OpenAI-compatible
 * API, requests are streamed through pi's built-in openai-completions
 * implementation.
 *
 * Configuration (environment variables):
 *   LLAMA_SWAP_BASE_URL  Optional. Defaults to http://localhost:9090/v1
 *   LLAMA_SWAP_CONTEXT   Optional. Context window fallback (tokens) for
 *                        models whose /models entry does not report one.
 *                        Default 128000
 *
 * No API key is required — the local endpoint is open. Image generation
 * models (those reporting `capabilities.image_generation: true`) are
 * filtered out so the model picker only lists chat-capable text/vision
 * models.
 *
 * The model list is fetched fresh at startup, so newly loaded models on
 * the server are picked up automatically when pi starts. If the fetch
 * fails, the provider is registered with no models and pi logs an error;
 * fix the server and run /reload to retry.
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASE_URL = "http://localhost:9090/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

interface LlamaSwapModelEntry {
	id: string;
	name?: string;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
	};
	capabilities?: {
		image_generation?: boolean;
		image_to_image?: boolean;
		vision?: boolean;
		function_calling?: boolean;
	};
	context_length?: number;
}

function positiveNumber(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toModel(entry: LlamaSwapModelEntry, defaultContextWindow: number): ProviderModelConfig | null {
	// Drop image generation models — they output images, not text.
	if (entry.capabilities?.image_generation) return null;

	// If the server reports a context length, use it. Otherwise fall back.
	const contextWindow = positiveNumber(entry.context_length, defaultContextWindow);

	// The server's input_modalities tells us whether the model accepts images.
	// Image-generation models are already filtered above, so any "image" in
	// input_modalities here means a vision-capable text model.
	const input = entry.architecture?.input_modalities?.includes("image")
		? (["text", "image"] as const)
		: (["text"] as const);

	return {
		id: entry.id,
		name: entry.name ?? entry.id,
		reasoning: false,
		input: [...input],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: DEFAULT_MAX_TOKENS,
	};
}

export default async function (pi: ExtensionAPI) {
	const baseUrl = (process.env.LLAMA_SWAP_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	const defaultContextWindow = positiveNumber(
		Number(process.env.LLAMA_SWAP_CONTEXT),
		DEFAULT_CONTEXT_WINDOW,
	);

	let models: ProviderModelConfig[] = [];

	try {
		const response = await fetch(`${baseUrl}/models`);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const payload = (await response.json()) as { data?: LlamaSwapModelEntry[] };
		models = (payload.data ?? [])
			.map((entry) => toModel(entry, defaultContextWindow))
			.filter((entry): entry is ProviderModelConfig => entry !== null);
	} catch (error) {
		console.error(
			`[llama-swap] Failed to fetch models from ${baseUrl}/models: ${error instanceof Error ? error.message : error}`,
		);
		console.error("[llama-swap] Registering provider with no models; fix the server and run /reload.");
	}

	pi.registerProvider("llama-swap", {
		name: "llama-swap (local)",
		baseUrl,
		// No API key — local endpoint is open. pi requires *some* value, so
		// use an empty string; openai-completions will skip the Authorization
		// header when the key is empty.
		apiKey: "",
		api: "openai-completions",
		models,
	});

	// Register commands for inspecting what's available on the server.
	pi.registerCommand("llama-swap-models", {
		description: "List llama-swap models with their loaded status and capabilities",
		handler: async (_args, ctx) => {
			try {
				const response = await fetch(`${baseUrl}/models`);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const payload = (await response.json()) as { data?: LlamaSwapModelEntry[] };
				const lines = (payload.data ?? [])
					.filter((m) => !m.capabilities?.image_generation)
					.map((m) => {
						const input = m.architecture?.input_modalities?.join("+") ?? "text";
						const ctx = positiveNumber(m.context_length, defaultContextWindow);
						return `${m.id} (input: ${input}, context: ${ctx})`;
					});
				ctx.ui.notify(`llama-swap models:\n${lines.join("\n")}`, "info");
			} catch (error) {
				ctx.ui.notify(
					`Failed to list llama-swap models: ${error instanceof Error ? error.message : error}`,
					"error",
				);
			}
		},
	});
}
