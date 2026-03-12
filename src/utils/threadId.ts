export const NEW_CHAT_NAME = "New Chat";

/** Check whether a thread ID represents a draft "New Chat" (e.g. "New Chat", "New Chat (2)"). */
export function isDraftChatName(name: string): boolean {
	if (name === NEW_CHAT_NAME) return true;
	const match = name.match(/^New Chat \((\d+)\)$/);
	return match !== null && Number(match[1]) >= 2;
}

export function createThreadId(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const seconds = String(now.getSeconds()).padStart(2, "0");
	return `Chat ${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}
