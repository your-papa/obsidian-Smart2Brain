import { Platform } from "obsidian";
import { getPlugin } from "../stores/state.svelte";

/**
 * Whether the plugin should present its mobile/touch UI.
 *
 * `Platform.isMobile` is the correct signal on a real device, but Obsidian's
 * desktop "mobile emulation" dev toggle leaves it `false` — it only flips
 * `app.isMobile` and the `is-mobile` body class (which our CSS keys off). To
 * keep JS-driven mobile affordances (search action bar, graph zoom buttons) in
 * sync with those CSS rules in the emulator as well as on hardware, treat
 * either signal as mobile.
 */
export function isMobileUI(): boolean {
	if (Platform.isMobile) return true;
	try {
		return (getPlugin().app as { isMobile?: boolean }).isMobile === true;
	} catch {
		return false;
	}
}
