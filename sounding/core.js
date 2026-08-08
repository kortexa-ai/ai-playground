export const READINGS = Object.freeze([
  Object.freeze({
    depth: 0,
    code: "CHANNEL OPEN",
    detail: "Passive hydrophone only. The water is louder than it should be.",
    feature: 0,
  }),
  Object.freeze({
    depth: 384,
    code: "NO SEAFLOOR RETURN",
    detail: "Pulse dispersed below the continental shelf.",
    feature: 1,
  }),
  Object.freeze({
    depth: 1260,
    code: "BIOLOGICAL NOISE",
    detail: "Duration: 19.4 seconds. Source wider than the array.",
    feature: 2,
  }),
  Object.freeze({
    depth: 2418,
    code: "RETURN WIDTH EXCEEDS ARRAY",
    detail: "No matching profile in the vessel library.",
    feature: 3,
  }),
  Object.freeze({
    depth: 3670,
    code: "CONTACT ALTERED BEARING",
    detail: "Course correction: 11 degrees toward the cable.",
    feature: 4,
  }),
  Object.freeze({
    depth: 4912,
    code: "CABLE LOAD INCREASING",
    detail: "Additional mass: 18 kilograms. Winch remains unlocked.",
    feature: 5,
  }),
  Object.freeze({
    depth: 6184,
    code: "RETURN PRECEDES PULSE",
    detail: "Timestamp discrepancy: 0.8 seconds.",
    feature: 6,
  }),
  Object.freeze({
    depth: 7420,
    code: "SECOND TRANSMITTER",
    detail: "Signal structure matches this array.",
    feature: 7,
  }),
  Object.freeze({
    depth: 8590,
    code: "IT IS REPEATING US",
    detail: "Delay is decreasing. No vessel is registered below.",
    feature: 8,
  }),
  Object.freeze({
    depth: 9331,
    code: "RANGE IS CLOSING",
    detail: "Cable angle: vertical. Contact bearing: vertical.",
    feature: 9,
  }),
  Object.freeze({
    depth: 9947,
    code: "DEPTH ERROR: −2 M",
    detail: "The return is arriving from above the transducer.",
    feature: 10,
    final: true,
  }),
]);

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function readingAt(index) {
  return READINGS[clamp(Math.trunc(index), 0, READINGS.length - 1)];
}

export function formatDepth(depth) {
  return Math.max(0, Math.round(depth)).toLocaleString("en-US", {
    minimumIntegerDigits: 4,
    useGrouping: false,
  });
}

export function formatPulse(index) {
  return String(clamp(Math.trunc(index), 0, 99)).padStart(2, "0");
}

export function echoDelay(index) {
  return Math.round(clamp(1500 - index * 92, 520, 1500));
}

export function depthAtProgress(fromDepth, toDepth, progress) {
  const amount = clamp(progress, 0, 1);
  const eased = 1 - Math.pow(1 - amount, 3);
  return fromDepth + (toDepth - fromDepth) * eased;
}

export function surveyCode(seed = Date.now()) {
  let value = Number(seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return `N-${String(value % 10000).padStart(4, "0")}`;
}
