import { describe, it, expect } from 'vitest';
import { LamportClock } from '../src/lamport-clock.js';

describe('LamportClock', () => {
  it('starts at 0 by default', () => {
    const clock = new LamportClock();
    expect(clock.value).toBe(0);
  });

  it('starts at custom initial value', () => {
    const clock = new LamportClock(5);
    expect(clock.value).toBe(5);
  });

  it('tick increments by 1', () => {
    const clock = new LamportClock();
    expect(clock.tick()).toBe(1);
    expect(clock.tick()).toBe(2);
    expect(clock.tick()).toBe(3);
    expect(clock.value).toBe(3);
  });

  it('merge takes max + 1', () => {
    const clock = new LamportClock(3);
    expect(clock.merge(10)).toBe(11);
    expect(clock.value).toBe(11);
  });

  it('merge with lower remote keeps local progress', () => {
    const clock = new LamportClock(10);
    expect(clock.merge(5)).toBe(11);
  });

  it('isValidNext requires strictly greater', () => {
    const clock = new LamportClock(5);
    expect(clock.isValidNext(6)).toBe(true);
    expect(clock.isValidNext(5)).toBe(false);
    expect(clock.isValidNext(4)).toBe(false);
  });
});
