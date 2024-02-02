import { init, addMessages } from 'svelte-i18n';

import en from './en.json';
import de from './de.json';

addMessages('en', en);
addMessages('de', de);

init({
    fallbackLocale: 'en',
    initialLocale: window.localStorage.getItem('language'),
});
