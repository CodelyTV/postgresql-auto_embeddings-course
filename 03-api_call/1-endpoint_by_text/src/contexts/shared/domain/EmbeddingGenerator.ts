import { Embedding } from "./Embedding";

export abstract class EmbeddingGenerator {
	abstract generate(input: string): Promise<Embedding>;
}
