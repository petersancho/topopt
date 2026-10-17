import type {Config, Load, Support} from './model';

export type CopiedObject =
  | {kind: 'load'; object: Load}
  | {kind: 'support'; object: Support};

const clipboardType = 'top88-studio-object';
const safeId = /^[-a-zA-Z0-9_]{1,80}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const coordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const force = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100;

/** Validate and rebuild just the supported data; never retain clipboard references. */
function snapshot(value: unknown): CopiedObject | null {
  if (!isRecord(value) || !isRecord(value.object)) return null;
  const object = value.object;
  if (typeof object.id !== 'string' || !safeId.test(object.id) ||
      !coordinate(object.x) || !coordinate(object.y)) return null;
  const {id, x, y} = object;
  if (value.kind === 'load' && force(object.fx) && force(object.fy)) {
    return {kind: 'load', object: {id, x, y, fx: object.fx, fy: object.fy}};
  }
  if (value.kind === 'support' && coordinate(object.x2) && coordinate(object.y2) &&
      x <= object.x2 && y <= object.y2 && typeof object.ux === 'boolean' &&
      typeof object.uy === 'boolean' && (object.ux || object.uy)) {
    return {kind: 'support', object: {
      id, x, y, x2: object.x2, y2: object.y2, ux: object.ux, uy: object.uy,
    }};
  }
  return null;
}

export function copyObject(config: Config, selected: string): CopiedObject | null {
  const load = config.loads.find(object => object.id === selected);
  if (load) return snapshot({kind: 'load', object: load});
  const support = config.supports.find(object => object.id === selected);
  return support ? snapshot({kind: 'support', object: support}) : null;
}

export function serializeCopiedObject(value: CopiedObject): string {
  const copy = snapshot(value);
  if (!copy) throw new TypeError('Invalid load or support clipboard data.');
  return JSON.stringify({type: clipboardType, version: 1, ...copy});
}

export function parseCopiedObject(text: string): CopiedObject | null {
  if (typeof text !== 'string' || text.length > 8192) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.type !== clipboardType || value.version !== 1) return null;
    return snapshot(value);
  } catch {
    return null;
  }
}

/** Move an intact span within the target domain, including at its far boundary. */
function shiftedStart(start: number, size: number, limit: number, offset: number) {
  const max = limit - size;
  const current = Math.max(0, Math.min(max, start));
  if (current + offset <= max) return current + offset;
  if (current - offset >= 0) return current - offset;
  return Math.max(0, Math.min(max, current + offset));
}

export function pasteObject(
  config: Config,
  value: CopiedObject,
  offset = 1,
): {patch: Partial<Config>; selected: string} | null {
  const copy = snapshot(value);
  if (!copy || !coordinate(config.nelx) || !coordinate(config.nely)) return null;
  const collection = copy.kind === 'load' ? config.loads : config.supports;
  if (collection.length >= 100) return null;
  const regions = (config as Config & {avoidedRegions?: {id: string}[]}).avoidedRegions;
  const ids = new Set([
    ...config.loads, ...config.supports, ...(Array.isArray(regions) ? regions : []),
  ].map(object => object.id));
  const prefix = copy.kind === 'load' ? 'L' : 'S';
  let number = 1;
  while (ids.has(prefix + number)) number++;
  const id = prefix + number;
  const distance = Number.isSafeInteger(offset) && offset > 0 ? offset : 1;

  if (copy.kind === 'load') {
    const object: Load = {
      ...copy.object, id,
      x: shiftedStart(copy.object.x, 0, config.nelx, distance),
      y: shiftedStart(copy.object.y, 0, config.nely, distance),
    };
    return {patch: {loads: [...config.loads, object]}, selected: id};
  }

  const width = copy.object.x2 - copy.object.x;
  const height = copy.object.y2 - copy.object.y;
  if (width > config.nelx || height > config.nely) return null;
  const x = shiftedStart(copy.object.x, width, config.nelx, distance);
  const y = shiftedStart(copy.object.y, height, config.nely, distance);
  const object: Support = {...copy.object, id, x, y, x2: x + width, y2: y + height};
  return {patch: {supports: [...config.supports, object]}, selected: id};
}
