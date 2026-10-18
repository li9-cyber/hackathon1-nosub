import {enhanceMouthProfile} from './mouth-clarity.js';
import {applyTeethLighting} from './teeth-lighting.js';
import {smoothMouthInterior} from './mouth-surface.js';

export function renderMouthQuality(image,prompt,profile='balanced',teeth='natural'){
  if(profile==='off')return {surface:{enabled:false,interior_pixels:0,changed_pixels:0,max_smoothing_correction:0},teeth:applyTeethLighting(image,prompt,'off')};
  const raw=new Uint8ClampedArray(image.data);
  enhanceMouthProfile(image,profile);
  const surface=smoothMouthInterior(image,raw,prompt);
  return {surface,teeth:applyTeethLighting(image,prompt,teeth)};
}
