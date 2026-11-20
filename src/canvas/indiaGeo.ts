/**
 * Compact 75-point mainland India border polygon and precomputed interior
 * landmass dot grid for zero-dependency Canvas 2D rendering.
 * Spans geographic frame lat 6.0-37.5, lng 67.0-98.0.
 */

export interface GeoBounds {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

export const INDIA_BOUNDS: GeoBounds = {
  minLat: 6.0,
  maxLat: 37.5,
  minLng: 67.0,
  maxLng: 98.0,
};

export const INDIA_CENTER_LAT = 22.1;
export const INDIA_CENTER_LNG = 82.5;

/**
 * Mainland India border polygon in clockwise [lat, lng] order (75 vertices).
 */
export const INDIA_BORDER: readonly (readonly [number, number])[] = [
  [8.08, 77.55], // Kanyakumari
  [8.45, 76.84], // Thiruvananthapuram coast
  [9.30, 76.40], // Alappuzha
  [10.15, 76.12], // Kochi coast
  [11.25, 75.76], // Kozhikode
  [12.88, 74.82], // Mangaluru
  [14.80, 74.10], // Karwar
  [15.38, 73.72], // Goa coast
  [17.00, 73.26], // Ratnagiri
  [19.05, 72.76], // Mumbai coast
  [20.12, 72.68], // Dahanu
  [21.18, 72.62], // Surat
  [22.25, 72.52], // Gulf of Khambhat head
  [21.72, 72.18], // Bhavnagar
  [20.88, 70.38], // Diu / Veraval
  [21.64, 69.58], // Porbandar
  [22.47, 69.05], // Dwarka / Okha
  [23.02, 70.15], // Kandla
  [23.72, 68.18], // Koteshwar / Lakhpat (west)
  [24.42, 69.45], // Rann of Kutch
  [25.35, 70.18], // Barmer border
  [26.78, 69.52], // Jaisalmer west
  [28.00, 70.65], // Bikaner west
  [29.92, 73.85], // Sri Ganganagar
  [31.65, 74.56], // Amritsar / Wagah
  [32.72, 74.82], // Jammu
  [34.10, 73.92], // Poonch / Uri
  [34.72, 73.78], // Kupwara
  [35.85, 73.35], // Gilgit west
  [37.08, 74.68], // Northern Kashmir / Mintaka
  [36.32, 76.25], // Karakoram
  [35.52, 77.85], // Karakoram Pass
  [35.35, 79.42], // Aksai Chin north-east
  [32.72, 79.42], // Pangong / Demchok
  [31.92, 78.65], // Kinnaur / Spiti
  [30.92, 79.62], // Uttarakhand north
  [30.22, 80.92], // Lipulekh
  [29.05, 80.12], // Tanakpur
  [28.18, 81.22], // Lakhimpur
  [27.45, 83.42], // Gorakhpur north
  [26.98, 84.88], // Raxaul
  [26.52, 88.08], // Kishanganj
  [27.08, 88.04], // Darjeeling
  [28.08, 88.62], // Sikkim north
  [27.24, 88.92], // Sikkim east
  [26.86, 89.38], // Bhutan west / Dooars
  [26.82, 91.84], // Bhutan east / Assam
  [27.64, 91.85], // Tawang
  [28.46, 93.42], // Arunachal west
  [29.18, 95.10], // Arunachal north
  [29.04, 96.36], // Dibang
  [28.02, 97.41], // Kibithu (east)
  [27.22, 96.18], // Changlang
  [26.35, 95.12], // Nagaland east
  [24.30, 94.34], // Manipur east
  [22.02, 92.94], // Mizoram south
  [23.45, 92.30], // Mizoram west
  [23.86, 91.22], // Agartala
  [25.18, 91.96], // Meghalaya south
  [25.88, 89.88], // Dhubri
  [26.28, 89.05], // Cooch Behar
  [26.24, 88.18], // Siliguri neck south
  [25.24, 88.46], // Balurghat
  [24.78, 87.92], // Malda
  [23.80, 88.78], // Nadia / Murshidabad
  [22.55, 88.95], // Sundarbans east
  [21.65, 88.45], // Sagar Island
  [21.56, 87.48], // Digha
  [19.75, 85.85], // Puri / Chilika
  [17.68, 83.28], // Visakhapatnam
  [16.65, 82.26], // Kakinada
  [15.10, 80.12], // Ongole
  [13.02, 80.32], // Chennai coast
  [10.30, 79.88], // Point Calimere
  [8.76, 78.18], // Thoothukudi
];

/**
 * Ray-casting point-in-polygon check against the mainland India border.
 */
export function isPointInIndia(
  lat: number,
  lng: number,
  polygon: readonly (readonly [number, number])[] = INDIA_BORDER
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const latI = polygon[i][0];
    const lngI = polygon[i][1];
    const latJ = polygon[j][0];
    const lngJ = polygon[j][1];

    const intersects =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Precomputes a flat Float32Array of interior landmass dots [lat0, lng0, lat1, lng1, ...]
 * on a ~0.55 degree grid within INDIA_BOUNDS.
 */
export function buildIndiaLandDots(stepDeg = 0.55): Float32Array {
  const coords: number[] = [];
  const latStep = stepDeg;
  const lngStep = stepDeg / Math.cos((INDIA_CENTER_LAT * Math.PI) / 180);

  for (let lat = 8.15; lat <= 37.1; lat += latStep) {
    for (let lng = 68.1; lng <= 97.5; lng += lngStep) {
      if (isPointInIndia(lat, lng)) {
        coords.push(lat, lng);
      }
    }
  }

  return new Float32Array(coords);
}

/**
 * Flattens INDIA_BORDER into a Float32Array of [lat0, lng0, ...] pairs for fast projection.
 */
export function buildIndiaBorderArray(): Float32Array {
  const out = new Float32Array(INDIA_BORDER.length * 2);
  for (let i = 0; i < INDIA_BORDER.length; i++) {
    out[i * 2] = INDIA_BORDER[i][0];
    out[i * 2 + 1] = INDIA_BORDER[i][1];
  }
  return out;
}

export const INDIA_LAND_DOTS: Float32Array = buildIndiaLandDots();
export const INDIA_BORDER_COORDS: Float32Array = buildIndiaBorderArray();
