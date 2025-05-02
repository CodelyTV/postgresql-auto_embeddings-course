/* eslint-disable camelcase,check-file/folder-naming-convention,no-console */
import "reflect-metadata";

import { NextResponse } from "next/server";

import { executeWithErrorHandling } from "../../../../contexts/shared/infrastructure/http/executeWithErrorHandling";
import { HttpNextResponse } from "../../../../contexts/shared/infrastructure/http/HttpNextResponse";

export async function POST(request: Request): Promise<NextResponse> {
	return executeWithErrorHandling(async () => {
		// Clonamos la request para poder leer el body sin consumirlo para usos posteriores
		const clonedRequest = request.clone();
		// Leemos el body como JSON (o .text() si esperas texto plano)
		try {
			const body = await clonedRequest.json();
			console.log("BODY:", body);
		} catch (error) {
			// Si el body no es JSON válido o está vacío, podría fallar
			console.error("Error reading request body as JSON:", error);
			// Opcionalmente, intenta leer como texto
			try {
				const textBody = await request.text(); // Usamos la request original aquí si falla el JSON
				console.log("BODY (raw text):", textBody);
			} catch (textError) {
				console.error("Error reading request body as text:", textError);
			}
		}

		// Aquí puedes continuar usando la request original si necesitas su body más adelante

		return HttpNextResponse.noContent();
	});
}
