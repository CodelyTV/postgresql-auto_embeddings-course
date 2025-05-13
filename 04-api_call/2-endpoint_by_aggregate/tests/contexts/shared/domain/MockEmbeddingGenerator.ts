import { Embedding } from "../../../../src/contexts/shared/domain/Embedding";
import { EmbeddingGenerator } from "../../../../src/contexts/shared/domain/EmbeddingGenerator";

export class MockEmbeddingGenerator extends EmbeddingGenerator {
	private readonly mockGenerate = jest.fn();

	async generate(input: string): Promise<Embedding> {
		expect(this.mockGenerate).toHaveBeenCalledWith(input);

		return this.mockGenerate() as Promise<Embedding>;
	}

	shouldGenerate(input: string, embedding: Embedding): void {
		this.mockGenerate(input);
		this.mockGenerate.mockReturnValueOnce(embedding);
	}
}
