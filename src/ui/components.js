// @ts-check

import {
  FIELD_STATUS,
  FILM_SIMULATIONS,
  WHITE_BALANCE_LABELS,
} from '../core/catalog.js';
import { formatRecipeValue } from '../core/recipe-resolution.js';

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {string} status */
export function statusBadge(status) {
  const labels = {
    [FIELD_STATUS.EXACT]: 'Detected',
    [FIELD_STATUS.ALIAS]: 'Alias',
    [FIELD_STATUS.INFERRED]: 'Inferred',
    [FIELD_STATUS.MISSING]: 'Missing',
    [FIELD_STATUS.INVALID]: 'Invalid',
    [FIELD_STATUS.CURRENT]: 'Current',
    [FIELD_STATUS.NEUTRAL]: 'Neutral',
    [FIELD_STATUS.USER]: 'Edited',
    [FIELD_STATUS.NOT_APPLICABLE]: 'N/A',
  };
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(labels[status] ?? status)}</span>`;
}

/**
 * @param {string} key
 * @param {any} value
 */
export function valueText(key, value) {
  if (key === 'filmSimulation') {
    return FILM_SIMULATIONS.find((simulation) => simulation.id === value)?.label ?? formatRecipeValue(key, value);
  }
  if (key === 'whiteBalanceMode') return WHITE_BALANCE_LABELS[value] ?? formatRecipeValue(key, value);
  return formatRecipeValue(key, value);
}

/**
 * @param {{ key: string, value: any, options: readonly any[], disabled?: boolean }} input
 */
export function discreteScale(input) {
  return `<div class="discrete-scale ${input.disabled ? 'is-disabled' : ''}" role="group" aria-label="${escapeHtml(input.key)}">
    ${input.options.map((option) => `<button type="button" class="scale-value ${sameValue(option, input.value) ? 'is-selected' : ''}" data-action="set-final" data-key="${escapeHtml(input.key)}" data-value="${escapeHtml(option)}" ${input.disabled ? 'disabled' : ''}>${escapeHtml(formatScaleOption(option))}</button>`).join('')}
  </div>`;
}

/**
 * @param {{ key: string, value: any, options: readonly any[], labels?: Record<string,string>, disabled?: boolean }} input
 */
export function selectControl(input) {
  return `<select data-action="set-final" data-key="${escapeHtml(input.key)}" ${input.disabled ? 'disabled' : ''}>
    ${input.options.map((option) => `<option value="${escapeHtml(option)}" ${sameValue(option, input.value) ? 'selected' : ''}>${escapeHtml(input.labels?.[option] ?? option)}</option>`).join('')}
  </select>`;
}

/** @param {{ key: string, value: number|null, min: number, max: number, step: number, disabled?: boolean, suffix?: string }} input */
export function numberControl(input) {
  return `<div class="number-control">
    <input type="number" data-action="set-final" data-key="${escapeHtml(input.key)}" value="${input.value ?? ''}" min="${input.min}" max="${input.max}" step="${input.step}" ${input.disabled ? 'disabled' : ''}>
    ${input.suffix ? `<span>${escapeHtml(input.suffix)}</span>` : ''}
  </div>`;
}

/**
 * Render a 19 x 19 Fujifilm-style WB shift grid.
 *
 * @param {{ red: number, blue: number, disabled?: boolean }} input
 */
export function wbGrid(input) {
  const cells = [];
  for (let blue = 9; blue >= -9; blue -= 1) {
    for (let red = -9; red <= 9; red += 1) {
      const selected = red === Number(input.red) && blue === Number(input.blue);
      cells.push(`<button type="button" class="wb-cell ${selected ? 'is-selected' : ''}" title="R ${signed(red)}, B ${signed(blue)}" data-action="set-wb" data-red="${red}" data-blue="${blue}" ${input.disabled ? 'disabled' : ''}><span></span></button>`);
    }
  }
  return `<div class="wb-grid-wrap ${input.disabled ? 'is-disabled' : ''}">
    <div class="wb-axis wb-axis-top">Blue +9</div>
    <div class="wb-axis wb-axis-left">Red -9</div>
    <div class="wb-grid">${cells.join('')}</div>
    <div class="wb-axis wb-axis-right">Red +9</div>
    <div class="wb-axis wb-axis-bottom">Blue -9</div>
    <div class="wb-readout">R ${signed(Number(input.red))} · B ${signed(Number(input.blue))}</div>
  </div>`;
}

/** @param {number} value */
export function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

/** @param {any} value */
function formatScaleOption(value) {
  if (typeof value === 'number') return value > 0 ? `+${value}` : String(value);
  return String(value);
}

/** @param {any} a @param {any} b */
function sameValue(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}
