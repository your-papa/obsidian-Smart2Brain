import { getPlugin } from "../stores/state.svelte";
import { getSecret, isValidSecretId, listSecrets, setSecret } from "../lib/secretStorage";

/**
 * Composable for managing secrets in the UI
 */
export function useSecrets() {
	const plugin = getPlugin();
	let secrets = $state<string[]>([]);

	function refresh() {
		try {
			secrets = listSecrets(plugin.app);
		} catch (e) {
			console.error("Failed to list secrets:", e);
			secrets = [];
		}
	}

	function saveSecret(id: string, value: string): boolean {
		if (!isValidSecretId(id)) {
			console.error("Invalid secret ID. Use only lowercase letters, numbers and dashes. Max 64 chars.");
			return false;
		}
		setSecret(plugin.app, id, value);
		refresh();
		return true;
	}

	function getSecretValue(id: string): string | null {
		return getSecret(plugin.app, id);
	}

	// Initial load
	refresh();

	return {
		get secrets() {
			return secrets;
		},
		refresh,
		saveSecret,
		getSecretValue,
		isValidSecretId,
	};
}
