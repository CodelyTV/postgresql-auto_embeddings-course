import { faker } from "@faker-js/faker";

import { Embedding } from "../../../../src/contexts/shared/domain/Embedding";

export class EmbeddingMother {
	static create(input?: string, output?: number[]): Embedding {
		return new Embedding(
			input ?? faker.lorem.sentences(2),
			output ?? [1, 2, 3],
		);
	}
}
