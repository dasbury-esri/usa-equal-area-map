export const lambertBounds = {
  conus: { xmin: -2117877.503544651, ymin: -1565584.2323137939, xmax: 2459236.151584033, ymax: 1247640.9185954602 },
  alaska: { xmin: -2504517.066485179, ymin: -1016942.8374766979, xmax: 1131965.3268343562, ymax: 881643.4461466632 },
};

export const albersBounds = {
  conus: { xmin: -2355976.4610482687, ymin: 268354.7203981299, xmax: 2258340.1476846067, ymax: 3172584.901201141 },
};

const albersAlaskaReference = {
  x: -601787.4469695078,
  y: 1417319.4019033893,
  resolution: 4615.543308115242,
  width: 719,
  height: 453,
};

export function fitPlacement({ width, height, drawerWidth, alaskaWidth, alaskaHeight }, bounds = lambertBounds) {
  const edge = 2;
  const anchor = 0.38;
  const conusWidth = bounds.conus.xmax - bounds.conus.xmin;
  const conusHeight = bounds.conus.ymax - bounds.conus.ymin;
  const alaskaReference = bounds === albersBounds ? albersAlaskaReference : null;
  const preferredResolution = alaskaReference
    ? alaskaReference.resolution * Math.max(alaskaReference.width / alaskaWidth, alaskaReference.height / alaskaHeight)
    : (bounds.alaska.ymax - bounds.alaska.ymin)
      * (2058369.0656399833 / 1898586.283623361) / alaskaHeight;
  const widthResolution = conusWidth / (width - drawerWidth - edge * 2);
  const heightResolution = conusHeight / (2 * (height * anchor - edge));
  const resolution = Math.max(preferredResolution, widthResolution, heightResolution);
  return {
    resolution,
    limitingConstraint: resolution === preferredResolution ? "alaska-height"
      : resolution === widthResolution ? "conus-width" : "conus-height",
    main: {
      x: (bounds.conus.xmin + bounds.conus.xmax) / 2 - drawerWidth / 2 * resolution,
      y: (bounds.conus.ymin + bounds.conus.ymax) / 2 + (anchor - 0.5) * height * resolution,
    },
    alaska: alaskaReference ? { x: alaskaReference.x, y: alaskaReference.y } : {
      x: bounds.alaska.xmax + (16.084023041720002 / 719 - 0.5) * alaskaWidth * resolution,
      y: bounds.alaska.ymax + (1.8818760584865117 / 453 - 0.5) * alaskaHeight * resolution,
    },
  };
}

export function fitOverview({ width, height }, albers = false) {
  return {
    resolution: 21446.509631258363 * (albers ? 1 : 1.002) * Math.max(719 / width, 399 / height),
    x: albers ? 19020.2579054083 : 482982.65986522695,
    y: albers ? 1993265.05938231 : 1773639.360344211,
    rotation: 20,
  };
}