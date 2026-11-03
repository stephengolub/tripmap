// The renderer: browser-safe, never imports from src/node/.

export type { BadgeKind } from './helpers.ts'
export { NAVY, PIN, STAR, badgeSvg, fmt0, lineD, pinSvg, polyD, smoothD, starPoints } from './helpers.ts'
export type { LabelBox } from './labeler.ts'
export { Labeler, SIDES, textW } from './labeler.ts'
export type { LandGeo, LegRoute, OsrmRouteResponse, RoadPiece, RouteServices } from './routes.ts'
export { TripRenderError, addOsrmPieces, boatPath, drawnLegs, landCut, resolver, routeLegs, seaRoute } from './routes.ts'
export { Canvas, buildSvg } from './svg.ts'
export { rasterizeSvgInBrowser } from './rasterize-browser.ts'
