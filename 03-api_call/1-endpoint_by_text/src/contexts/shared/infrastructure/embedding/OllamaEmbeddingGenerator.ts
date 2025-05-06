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
	private readonly embeddings: OllamaEmbeddings;

	constructor() {
		super();

		this.embeddings = new OllamaEmbeddings({
			baseUrl: "http://localhost:11434",
			model: "nomic-embed-text",
		});
	}

	async generate(input: string): Promise<Embedding> {
		return new Embedding(await this.embeddings.embedQuery(input));
	}
}
