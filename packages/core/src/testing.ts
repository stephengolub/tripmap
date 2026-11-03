// Deterministic, offline Services for tests: town centre equals the input, no landmarks,
// no stations, everything on land, every pair drivable, no rail. Override any member.

import type { Services, Stations } from './services.ts'

export const NO_STATIONS: Stations = { nearest: () => null }

export function FakeServices(overrides: Partial<Services> = {}): Services {
  return {
    townCentre: async (_name, _cc, near) => [near[0], near[1]],
    landmarks: async (spots) => spots.map(() => null),
    stations: async () => NO_STATIONS,
    classify: () => ({ landmass: 0, atSea: false }),
    classifyStrict: () => 0,
    nearestLandmass: () => 0,
    coastKm: () => 100,
    drivable: async () => true,
    roadKm: async () => 0,
    rail: async () => null,
    ...overrides,
  }
}
