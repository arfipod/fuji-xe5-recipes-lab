import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRecipeText, parseFractionNumber } from '../src/core/parser.js';

const ASTIA = `Astia
Dynamic Range: DR200
Highlight: -1
Shadow: -2
Color: +1
Noise Reduction: -3
Sharpening: +1
Grain Effect: Weak
White Balance: Auto
ISO: Auto up to ISO 12800
Exposure Compensation: +1/3 (typically)`;

const PRO_NEG = `PRO Neg. Std
Dynamic Range: DR400
Highlight: +2
Shadow: +3
Color: +4
Noise Reduction: -3
Sharpening: 0
Grain Effect: Strong
White Balance: Auto, +5 Red & -3 Blue
ISO: Auto up to ISO 6400
Exposure Compensation: +1/3 (typically)`;

test('parses a legacy Astia recipe with aliases and shooting reminders', () => {
  const recipe = parseRecipeText(ASTIA);
  assert.equal(recipe.values.filmSimulation, 'Astia');
  assert.equal(recipe.values.dynamicRange, 'DR200');
  assert.equal(recipe.values.highlight, -1);
  assert.equal(recipe.values.shadow, -2);
  assert.equal(recipe.values.color, 1);
  assert.equal(recipe.values.highIsoNr, -3);
  assert.equal(recipe.fields.highIsoNr.status, 'alias');
  assert.equal(recipe.values.sharpness, 1);
  assert.equal(recipe.fields.sharpness.status, 'alias');
  assert.equal(recipe.values.grainStrength, 'Weak');
  assert.equal(recipe.values.grainSize, null);
  assert.equal(recipe.values.whiteBalanceMode, 'Auto');
  assert.equal(recipe.values.wbShiftR, null);
  assert.equal(recipe.values.isoMode, 'Auto');
  assert.equal(recipe.values.isoMax, 12800);
  assert.equal(recipe.values.exposureMinEv, 1 / 3);
  assert.equal(recipe.values.exposureMaxEv, 1 / 3);
  assert.equal(recipe.values.exposureTypical, true);
  assert.equal(recipe.targetGeneration, 'legacy');
});

test('parses PRO Neg. Std and white-balance shifts', () => {
  const recipe = parseRecipeText(PRO_NEG);
  assert.equal(recipe.values.filmSimulation, 'ProNegStd');
  assert.equal(recipe.values.dynamicRange, 'DR400');
  assert.equal(recipe.values.wbShiftR, 5);
  assert.equal(recipe.values.wbShiftB, -3);
  assert.equal(recipe.values.isoMax, 6400);
});

test('parses the proposed Classic Chrome C1 source without losing shooting reminders', () => {
  const recipe = parseRecipeText(`Film Simulation: Classic Chrome
Grain Effect: Strong, Small
Color Chrome Effect: Strong
Color Chrome FX Blue: Off
White Balance: 5200K, +1 Red & -6 Blue
Dynamic Range: DR400
Highlight: 0
Shadow: -2
Color: +2
Sharpness: -2
High ISO NR: -4
Clarity: -2
ISO: Auto, up to ISO 6400
Exposure Compensation: +1/3 to +1 (typically)`);

  assert.deepEqual({
    filmSimulation: recipe.values.filmSimulation,
    grainStrength: recipe.values.grainStrength,
    grainSize: recipe.values.grainSize,
    colorChrome: recipe.values.colorChrome,
    colorChromeBlue: recipe.values.colorChromeBlue,
    whiteBalanceMode: recipe.values.whiteBalanceMode,
    whiteBalanceKelvin: recipe.values.whiteBalanceKelvin,
    wbShiftR: recipe.values.wbShiftR,
    wbShiftB: recipe.values.wbShiftB,
    dynamicRange: recipe.values.dynamicRange,
    highlight: recipe.values.highlight,
    shadow: recipe.values.shadow,
    color: recipe.values.color,
    sharpness: recipe.values.sharpness,
    highIsoNr: recipe.values.highIsoNr,
    clarity: recipe.values.clarity,
    isoMode: recipe.values.isoMode,
    isoMax: recipe.values.isoMax,
    exposureMinEv: recipe.values.exposureMinEv,
    exposureMaxEv: recipe.values.exposureMaxEv,
    exposureTypical: recipe.values.exposureTypical,
  }, {
    filmSimulation: 'ClassicChrome',
    grainStrength: 'Strong',
    grainSize: 'Small',
    colorChrome: 'Strong',
    colorChromeBlue: 'Off',
    whiteBalanceMode: 'Temperature',
    whiteBalanceKelvin: 5200,
    wbShiftR: 1,
    wbShiftB: -6,
    dynamicRange: 'DR400',
    highlight: 0,
    shadow: -2,
    color: 2,
    sharpness: -2,
    highIsoNr: -4,
    clarity: -2,
    isoMode: 'Auto',
    isoMax: 6400,
    exposureMinEv: 1 / 3,
    exposureMaxEv: 1,
    exposureTypical: true,
  });
  assert.equal(recipe.fields.smoothSkin.status, 'missing');
  assert.match(recipe.warnings.join(' '), /ISO guidance is stored as a shooting reminder/);
  assert.match(recipe.warnings.join(' '), /Exposure compensation must be set manually/);
});

test('parses a contiguous markdown recipe without line separators', () => {
  const source = '**Film Simulation: Nostalgic Neg**.**Grain Effect: Weak, Large****Color Chrome Effect: Strong****Color Chrome FX Blue: Weak****White Balance: 5900K, -1 Red & -6 BlueDynamic Range: DR100Highlight: +2Shadow: -2Color: -2Sharpness: -4****High ISO NR: -4Clarity: -4ISO: Auto, up to ISO 6400Exposure Compensation: -1/3 to +1/3 (typically)**';
  const recipe = parseRecipeText(source);
  assert.equal(recipe.values.filmSimulation, 'NostalgicNeg');
  assert.equal(recipe.values.grainStrength, 'Weak');
  assert.equal(recipe.values.grainSize, 'Large');
  assert.equal(recipe.values.colorChrome, 'Strong');
  assert.equal(recipe.values.colorChromeBlue, 'Weak');
  assert.equal(recipe.values.whiteBalanceMode, 'Temperature');
  assert.equal(recipe.values.whiteBalanceKelvin, 5900);
  assert.equal(recipe.values.wbShiftR, -1);
  assert.equal(recipe.values.wbShiftB, -6);
  assert.equal(recipe.values.dynamicRange, 'DR100');
  assert.equal(recipe.values.clarity, -4);
  assert.equal(recipe.values.exposureMinEv, -1 / 3);
  assert.equal(recipe.values.exposureMaxEv, 1 / 3);
  assert.equal(recipe.targetGeneration, 'x-trans-v');
});

test('recognizes D-Range Priority embedded in Dynamic Range', () => {
  const recipe = parseRecipeText(`Classic Chrome\nDynamic Range: DR-P Strong\nGrain Effect: Weak, Small\nWhite Balance: Daylight`);
  assert.equal(recipe.values.dRangePriority, 'Strong');
  assert.equal(recipe.fields.dynamicRange.status, 'not-applicable');
  assert.equal(recipe.fields.highlight.status, 'not-applicable');
  assert.equal(recipe.fields.shadow.status, 'not-applicable');
});

test('parses monochromatic toning and marks Color not applicable', () => {
  const recipe = parseRecipeText(`ACROS + R\nDynamic Range: DR400\nMonochromatic Color (Toning): WC -4 & MG +8\nHighlight: 0\nShadow: +1\nWhite Balance: Auto`);
  assert.equal(recipe.values.filmSimulation, 'AcrosR');
  assert.equal(recipe.values.monoWarmCool, -4);
  assert.equal(recipe.values.monoMagentaGreen, 8);
  assert.equal(recipe.fields.color.status, 'not-applicable');
});

test('parses the proposed neutral ACROS FS3 target and retains shooting reminders', () => {
  const recipe = parseRecipeText(`Film Simulation: Acros
Monochromatic Color (Toning): WC 0 & MG 0
Dynamic Range: DR-Auto
Grain Effect: Strong, Large
Color Chrome Effect: Off
Color Chrome FX Blue: Off
White Balance: Auto, 0 Red & 0 Blue
Highlight: +4
Shadow: +2
Sharpness: -4
High ISO NR: -4
Clarity: +5
ISO: Auto, up to ISO 12800
Exposure Compensation: 0 to +2/3 (typically)`);

  assert.deepEqual({
    filmSimulation: recipe.values.filmSimulation,
    monoWarmCool: recipe.values.monoWarmCool,
    monoMagentaGreen: recipe.values.monoMagentaGreen,
    dynamicRange: recipe.values.dynamicRange,
    grainStrength: recipe.values.grainStrength,
    grainSize: recipe.values.grainSize,
    whiteBalanceMode: recipe.values.whiteBalanceMode,
    wbShiftR: recipe.values.wbShiftR,
    wbShiftB: recipe.values.wbShiftB,
    highlight: recipe.values.highlight,
    shadow: recipe.values.shadow,
    color: recipe.values.color,
    sharpness: recipe.values.sharpness,
    highIsoNr: recipe.values.highIsoNr,
    clarity: recipe.values.clarity,
    isoMax: recipe.values.isoMax,
    exposureMinEv: recipe.values.exposureMinEv,
    exposureMaxEv: recipe.values.exposureMaxEv,
  }, {
    filmSimulation: 'Acros',
    monoWarmCool: 0,
    monoMagentaGreen: 0,
    dynamicRange: 'Auto',
    grainStrength: 'Strong',
    grainSize: 'Large',
    whiteBalanceMode: 'Auto',
    wbShiftR: 0,
    wbShiftB: 0,
    highlight: 4,
    shadow: 2,
    color: null,
    sharpness: -4,
    highIsoNr: -4,
    clarity: 5,
    isoMax: 12800,
    exposureMinEv: 0,
    exposureMaxEv: 2 / 3,
  });
  assert.equal(recipe.fields.color.status, 'not-applicable');
  assert.match(recipe.warnings.join(' '), /ISO guidance is stored as a shooting reminder/);
  assert.match(recipe.warnings.join(' '), /Exposure compensation must be set manually/);
});

test('parses signed fractions and mixed numbers', () => {
  assert.equal(parseFractionNumber('+1/3'), 1 / 3);
  assert.equal(parseFractionNumber('-2/3'), -2 / 3);
  assert.equal(parseFractionNumber('+1 1/3'), 4 / 3);
  assert.equal(parseFractionNumber('-1.5'), -1.5);
});
