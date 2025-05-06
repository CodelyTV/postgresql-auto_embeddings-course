import { EmbeddingMother } from "../../../contexts/shared/domain/EmbeddingMother";
import { fetchLocal } from "../fetchLocal";

describe(`POST /api/embeddings should`, () => {
	it("return 200 with a 768 dimension embedding with a valid input", async () => {
		const response = await fetchLocal("/api/embeddings", {
			method: "POST",
			body: JSON.stringify({
				input: EmbeddingMother.create().input,
			}),
			headers: { "Content-Type": "application/json" },
		});

		const responseBody = await response.json();

		expect(response.status).toBe(200);
		expect(responseBody).toHaveProperty("embedding");
		expect(responseBody.embedding.length).toBe(768);
	});
});
