import { App } from './ui/app.ts';

const host = document.getElementById('app');
if (!host) throw new Error('#app container is missing');

// Starts on the welcome screen; a session appears when a file (or the sample)
// is opened.
new App(host);
