import { OllamaEmbeddings } from "@langchain/ollama";
import { Service } from "diod";
import { TextEncoder } from "node:util";

import { Embedding } from "../../domain/Embedding";
import { EmbeddingGenerator } from "../../domain/EmbeddingGenerator";

if (typeof globalThis.TextEncoder === "undefined") {
	globalThis.TextEncoder = TextEncoder;
}

@Service()
export class OllamaEmbeddingGenerator extends EmbeddingGenerator {
	private readonly maxAttemptsToRetry = 3;
	private readonly embeddings: OllamaEmbeddings;

	constructor() {
		super();

		this.embeddings = new OllamaEmbeddings({
			baseUrl: "http://localhost:11434",
			model: "nomic-embed-text",
		});
	}

	async generate(input: string): Promise<Embedding> {
		const output = await this.retry(
			async () => this.embeddings.embedQuery(input),
			this.maxAttemptsToRetry,
		);

		return new Embedding(input, output);
	}

	private async retry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
		try {
			return await fn();
		} catch (error) {
			if (retries <= 0) {
				throw error;
			}

			return this.retry(fn, retries - 1);
		}
	}
}
