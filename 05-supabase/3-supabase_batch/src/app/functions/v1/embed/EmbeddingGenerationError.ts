/* eslint-disable check-file/folder-naming-convention */
import { DomainError } from "../../../../contexts/shared/domain/DomainError";

export class EmbeddingGenerationError extends DomainError {
	readonly type = `EmbeddingGenerationError`;
	readonly message = `Embedding generation failed for ${this.errorMessage}`;

	constructor(public readonly errorMessage: string) {
		super();
	}
}
