import {stop,resetSession} from './attention/realeye-controller.js';

// The same visible practice section is used in normal and fullscreen modes.
// Showing the panel never requests camera permission or starts tracking.
function reset(){resetSession();}
document.addEventListener('career:interview',event=>{if(!event.detail.visible)reset();});
window.CareerAttention={stop,reset};
