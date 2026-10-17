import {describe, expect, it} from 'vitest';
import {preset, type Config} from './model';
import {
  copyObject, parseCopiedObject, pasteObject, serializeCopiedObject, type CopiedObject,
} from './clipboard';

const loadCopy = (): CopiedObject => ({kind: 'load', object: {id: 'L1', x: 30, y: 15, fx: 2.5, fy: -1}});
const supportCopy = (): CopiedObject => ({
  kind: 'support', object: {id: 'S1', x: 10, y: 5, x2: 15, y2: 8, ux: true, uy: false},
});
const encode = (copy: unknown) => JSON.stringify({type: 'top88-studio-object', version: 1, ...copy as object});

describe('object clipboard', () => {
  it('takes independent snapshots of selected loads and supports', () => {
    const config = preset();
    const load = copyObject(config, 'L1');
    const support = copyObject(config, 'S1');
    expect(load).toEqual({kind: 'load', object: config.loads[0]});
    expect(support).toEqual({kind: 'support', object: config.supports[0]});
    expect(load?.object).not.toBe(config.loads[0]);
    expect(support?.object).not.toBe(config.supports[0]);
    config.loads[0].fy = 9;
    config.supports[0].x2 = 4;
    expect(load?.object).toMatchObject({fy: -1});
    expect(support?.object).toMatchObject({x2: 0});
    expect(copyObject(config, 'missing')).toBeNull();
  });

  it('duplicates a load with a short unique id, preserved force, and node offsets', () => {
    const config = preset();
    const copy = loadCopy();
    const pasted = pasteObject(config, copy)!;
    expect(pasted.selected).toBe('L2');
    expect(pasted.patch.loads?.at(-1)).toEqual({id: 'L2', x: 31, y: 16, fx: 2.5, fy: -1});
    expect(config.loads).toHaveLength(1);
    expect(copy.object.x).toBe(30);
    expect(pasted.patch.loads?.at(-1)).not.toBe(copy.object);
  });

  it('moves boundary loads inward and clamps loads copied from larger projects', () => {
    const config = preset();
    expect(pasteObject(config, copyObject(config, 'L1')!)?.patch.loads?.at(-1))
      .toMatchObject({x: 59, y: 16});
    const smaller = {...config, nelx: 8, nely: 4};
    expect(pasteObject(smaller, loadCopy())?.patch.loads?.at(-1))
      .toMatchObject({x: 7, y: 3});
  });

  it('preserves support dimensions and directions when moving within boundaries', () => {
    const config = preset();
    const copy = supportCopy();
    const pasted = pasteObject(config, copy)!;
    expect(pasted.patch.supports?.at(-1))
      .toEqual({id: 'S2', x: 11, y: 6, x2: 16, y2: 9, ux: true, uy: false});
    const boundary: CopiedObject = {kind: 'support', object: {
      id: 'S1', x: 55, y: 27, x2: 60, y2: 30, ux: false, uy: true,
    }};
    expect(pasteObject(config, boundary)?.patch.supports?.at(-1))
      .toEqual({id: 'S2', x: 54, y: 26, x2: 59, y2: 29, ux: false, uy: true});
    expect(copy.object).toMatchObject({x: 10, y: 5, x2: 15, y2: 8});
  });

  it('keeps full-axis and point supports intact', () => {
    const config = preset();
    expect(pasteObject(config, copyObject(config, 'S1')!)?.patch.supports?.at(-1))
      .toMatchObject({x: 1, x2: 1, y: 0, y2: 30});
    const point: CopiedObject = {kind: 'support', object: {
      id: 'S1', x: 60, y: 30, x2: 60, y2: 30, ux: true, uy: true,
    }};
    expect(pasteObject(config, point)?.patch.supports?.at(-1))
      .toMatchObject({x: 59, x2: 59, y: 29, y2: 29});
  });

  it('fits support spans into smaller projects without shrinking and rejects oversized spans', () => {
    const smaller = {...preset(), nelx: 8, nely: 4};
    expect(pasteObject(smaller, supportCopy())?.patch.supports?.at(-1))
      .toMatchObject({x: 2, y: 0, x2: 7, y2: 3});
    const tooSmall = {...smaller, nelx: 4};
    expect(pasteObject(tooSmall, supportCopy())).toBeNull();
    const exact = {...preset(), nelx: 5, nely: 3};
    expect(pasteObject(exact, supportCopy())?.patch.supports?.at(-1))
      .toMatchObject({x: 0, y: 0, x2: 5, y2: 3});
  });

  it('avoids identifiers used by any object kind, including avoided regions', () => {
    const config = preset();
    config.supports.push({...config.supports[0], id: 'L2'});
    const extended = {...config, avoidedRegions: [{id: 'L3'}]} as unknown as Config;
    expect(pasteObject(extended, loadCopy())?.selected).toBe('L4');
    config.loads.push({...config.loads[0], id: 'S2'});
    expect(pasteObject(config, supportCopy())?.selected).toBe('S3');
  });

  it('supports successive paste offsets and generates fresh ids each time', () => {
    let config = preset();
    const copy = loadCopy();
    for (let offset = 1; offset <= 3; offset++) {
      const pasted = pasteObject(config, copy, offset)!;
      expect(pasted.selected).toBe(`L${offset + 1}`);
      expect(pasted.patch.loads?.at(-1)).toMatchObject({x: 30 + offset, y: 15 + offset});
      config = {...config, ...pasted.patch};
    }
    expect(config.loads).toHaveLength(4);
    expect(copy.object).toMatchObject({x: 30, y: 15});
    expect(pasteObject(config, copy, 1000)?.patch.loads?.at(-1))
      .toMatchObject({x: 60, y: 30});
  });

  it('round trips supported clipboard data and strips unrelated object properties', () => {
    for (const copy of [loadCopy(), supportCopy()]) {
      const text = serializeCopiedObject(copy);
      expect(JSON.parse(text)).toMatchObject({type: 'top88-studio-object', version: 1});
      expect(parseCopiedObject(text)).toEqual(copy);
      expect(parseCopiedObject(text)?.object).not.toBe(copy.object);
    }
    const copy = loadCopy();
    expect(parseCopiedObject(encode({...copy, object: {...copy.object, arbitrary: 'ignored'}})))
      .toEqual(copy);
  });

  it.each([
    '', 'plain text', '{', 'null', '[]', JSON.stringify(preset()),
    '{"type":"top88-studio-object","version":2}',
    encode({kind: 'region', object: loadCopy().object}),
    encode({kind: 'load', object: null}),
    encode({kind: 'load', object: {...loadCopy().object, id: '<script>'}}),
    encode({kind: 'load', object: {...loadCopy().object, id: ''}}),
    encode({kind: 'load', object: {...loadCopy().object, x: -1}}),
    encode({kind: 'load', object: {...loadCopy().object, x: 1.5}}),
    encode({kind: 'load', object: {...loadCopy().object, y: '1'}}),
    encode({kind: 'load', object: {...loadCopy().object, fx: 101}}),
    encode({kind: 'load', object: {...loadCopy().object, fy: null}}),
    encode({kind: 'support', object: {...supportCopy().object, x2: 0}}),
    encode({kind: 'support', object: {...supportCopy().object, ux: 'true'}}),
    encode({kind: 'support', object: {...supportCopy().object, ux: false, uy: false}}),
  ])('rejects malformed or unrelated clipboard text: %s', text => {
    expect(parseCopiedObject(text)).toBeNull();
  });

  it('rejects nonfinite values, unsafe coordinates, and oversized clipboard text', () => {
    const copy = loadCopy();
    expect(pasteObject(preset(), {...copy, object: {...copy.object, x: Infinity}} as CopiedObject)).toBeNull();
    expect(() => serializeCopiedObject({...copy, object: {...copy.object, fx: NaN}} as CopiedObject)).toThrow();
    expect(parseCopiedObject(encode({...copy, object: {...copy.object, x: Number.MAX_SAFE_INTEGER + 1}}))).toBeNull();
    expect(parseCopiedObject(' '.repeat(8193))).toBeNull();
    expect(pasteObject({...preset(), nelx: NaN}, copy)).toBeNull();
  });

  it('enforces the 100-per-kind limit independently', () => {
    const config = preset();
    config.loads = Array.from({length: 100}, (_, i) => ({...config.loads[0], id: `L${i + 1}`}));
    expect(pasteObject(config, loadCopy())).toBeNull();
    expect(pasteObject(config, supportCopy())).not.toBeNull();
    config.supports = Array.from({length: 100}, (_, i) => ({...config.supports[0], id: `S${i + 1}`}));
    expect(pasteObject(config, supportCopy())).toBeNull();
  });
});
