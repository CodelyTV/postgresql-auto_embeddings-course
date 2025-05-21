import { type NextRequest, type NextResponse } from "next/server";

import { DomainError } from "../../domain/DomainError";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = { params: Promise<any> };

type HandlerWithRequestAndParams = (
	request: NextRequest,
	params: Params,
) => Promise<NextResponse>;

type HandlerWithRequest = (request: NextRequest) => Promise<NextResponse>;

type HandlerWithoutInput = () => Promise<NextResponse>;

type Handler =
	| HandlerWithoutInput
	| HandlerWithRequest
	| HandlerWithRequestAndParams;

export function withErrorHandling<
	HandlerType extends Handler,
	T extends DomainError,
>(
	handler: HandlerType,
	onError: (error: T) => NextResponse | void = () => undefined,
): HandlerType {
	return async function (
		request?: NextRequest,
		params?: Params,
	): Promise<NextResponse> {
		const wrappedHandler: () => Promise<NextResponse> =
			async (): Promise<NextResponse> => {
				if (request && params) {
					return await (handler as HandlerWithRequestAndParams)(
						request,
						params,
					);
				}

				if (request) {
					return await (handler as HandlerWithRequest)(request);
				}

				return await (handler as HandlerWithoutInput)();
			};

		try {
			return await wrappedHandler();
		} catch (error) {
			if (error instanceof DomainError) {
				const response = onError(error as T);

				if (response) {
					return response;
				}
			}

			throw error;
		}
	} as HandlerType;
}
