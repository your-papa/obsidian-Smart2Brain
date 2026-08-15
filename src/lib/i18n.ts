import { init, addMessages } from "svelte-i18n";

import en from "./en.json";

addMessages("en", en);

init({
	fallbackLocale: "en",
	initialLocale: window.localStorage.getItem("language"),
});
