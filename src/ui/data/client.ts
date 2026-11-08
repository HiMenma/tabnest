import type { ErrorResponse, RequestMessage, ResponseByRequest } from "../../types/messages";

export class WorkerError extends Error {}

/** Sends a request to the service worker and unwraps the typed reply. */
export async function send<T extends RequestMessage>(
  message: T,
): Promise<ResponseByRequest[T["type"]]> {
  let reply: ResponseByRequest[T["type"]] | ErrorResponse | undefined;
  try {
    reply = (await chrome.runtime.sendMessage(message)) as
      | ResponseByRequest[T["type"]]
      | ErrorResponse
      | undefined;
  } catch (error) {
    throw new WorkerError(error instanceof Error ? error.message : String(error));
  }

  if (reply === undefined || reply === null) {
    throw new WorkerError("the worker did not answer");
  }
  if (typeof reply === "object" && "error" in reply) {
    throw new WorkerError(String((reply as ErrorResponse).error));
  }
  return reply as ResponseByRequest[T["type"]];
}
