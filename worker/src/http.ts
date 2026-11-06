// An error the API answers with: its status code and a message the page can show as it is.
export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}
